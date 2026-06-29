#include "capture/curlparse_event_scan.h"

#include <stdlib.h>
#include <string.h>

#include "runtime/curlparse_curl_compat.h"
#include "tool_getparam.h"

struct EventBuilder {
  struct CurlparseOptionEvent *events;
  size_t count;
  size_t capacity;
};

static int push_event(
  struct EventBuilder *builder,
  const struct CurlparseOptionEvent *event
)
{
  struct CurlparseOptionEvent *grown;

  if(builder->count == builder->capacity) {
    size_t new_capacity = builder->capacity ? (builder->capacity * 2) : 8;
    grown = realloc(builder->events, new_capacity * sizeof(*grown));
    if(!grown) {
      return -1;
    }
    builder->events = grown;
    builder->capacity = new_capacity;
  }

  builder->events[builder->count++] = *event;
  return 0;
}

static bool option_takes_value(unsigned char desc)
{
  switch(ARGTYPE(desc)) {
  case ARG_STRG:
  case ARG_FILE:
  case ARG_SECS:
  case ARG_UNUM:
    return true;
  default:
    return false;
  }
}

static int record_positional(
  struct EventBuilder *builder,
  unsigned operation_index,
  unsigned argv_index,
  const char *value
)
{
  struct CurlparseOptionEvent event;

  memset(&event, 0, sizeof(event));
  event.operation_index = operation_index;
  event.argv_index = argv_index;
  event.raw_flag = value;
  event.canonical = NULL;
  event.has_value = true;
  event.value = value;
  event.value_argv_index = argv_index;
  event.is_positional = true;
  return push_event(builder, &event);
}

static int record_option(
  struct EventBuilder *builder,
  unsigned operation_index,
  unsigned argv_index,
  const char *raw_flag,
  const char *canonical,
  bool has_value,
  const char *value,
  unsigned value_argv_index,
  bool used_nextarg,
  bool negated,
  bool is_next
)
{
  struct CurlparseOptionEvent event;

  memset(&event, 0, sizeof(event));
  event.operation_index = operation_index;
  event.argv_index = argv_index;
  event.raw_flag = raw_flag;
  event.canonical = canonical;
  event.has_value = has_value;
  event.value = value;
  event.value_argv_index = value_argv_index;
  event.used_nextarg = used_nextarg;
  event.negated = negated;
  event.is_next = is_next;
  return push_event(builder, &event);
}

static int scan_long_option(
  struct EventBuilder *builder,
  const char *token,
  unsigned *operation_index,
  unsigned argv_index,
  const char *const *argv,
  size_t argc,
  size_t *indexp
)
{
  const struct LongShort *option = NULL;
  const char *name = token + 2;
  const char *inline_value = strchr(name, '=');
  size_t name_len = inline_value ? (size_t)(inline_value - name) : strlen(name);
  char *lookup_base = NULL;
  char *lookup_name = NULL;
  bool negated = false;
  bool has_value = false;
  bool used_nextarg = false;
  const char *value = NULL;
  unsigned value_argv_index = 0;
  int rc;

  if(strcmp(token, "--") == 0) {
    return 1;
  }

  lookup_base = malloc(name_len + 1);
  if(!lookup_base) {
    return -1;
  }

  memcpy(lookup_base, name, name_len);
  lookup_base[name_len] = '\0';
  lookup_name = lookup_base;
  option = findlongopt(lookup_name);

  if(!option && strncmp(lookup_name, "no-", 3) == 0) {
    option = findlongopt(lookup_name + 3);
    if(option && (option->desc & ARG_NO)) {
      negated = true;
      lookup_name += 3;
    }
    else {
      option = NULL;
    }
  }

  if(option && option_takes_value(option->desc)) {
    if(inline_value) {
      has_value = true;
      value = inline_value + 1;
      value_argv_index = argv_index;
    }
    else if((*indexp + 1) < argc) {
      used_nextarg = true;
      has_value = true;
      ++(*indexp);
      value = argv[*indexp];
      value_argv_index = (unsigned)*indexp;
    }
  }

  if(option) {
    rc = record_option(builder,
                       *operation_index,
                       argv_index,
                       token,
                       option->lname,
                       has_value,
                       value,
                       value_argv_index,
                       used_nextarg,
                       negated,
                       option->cmd == C_NEXT);
    if(rc != 0) {
      free(lookup_base);
      return -1;
    }
    if(option->cmd == C_NEXT) {
      ++(*operation_index);
    }
  }
  else {
    rc = record_positional(builder, *operation_index, argv_index, token);
    if(rc != 0) {
      free(lookup_base);
      return -1;
    }
  }

  free(lookup_base);
  return 0;
}

static int scan_short_option_bundle(
  struct EventBuilder *builder,
  const char *token,
  unsigned *operation_index,
  unsigned argv_index,
  const char *const *argv,
  size_t argc,
  size_t *indexp
)
{
  size_t pos;

  for(pos = 1; token[pos]; ++pos) {
    const struct LongShort *option = findshortopt(token[pos]);
    bool has_value = false;
    bool used_nextarg = false;
    const char *value = NULL;
    unsigned value_argv_index = 0;

    if(!option) {
      if(record_positional(builder, *operation_index, argv_index, token) != 0) {
        return -1;
      }
      return 0;
    }

    if(option_takes_value(option->desc)) {
      has_value = true;
      if(token[pos + 1]) {
        value = token + pos + 1;
        value_argv_index = argv_index;
      }
      else if((*indexp + 1) < argc) {
        used_nextarg = true;
        ++(*indexp);
        value = argv[*indexp];
        value_argv_index = (unsigned)*indexp;
      }
    }

    if(record_option(builder,
                      *operation_index,
                      argv_index,
                      token,
                      option->lname,
                      has_value,
                      value,
                      value_argv_index,
                      used_nextarg,
                      false,
                      option->cmd == C_NEXT) != 0) {
      return -1;
    }

    if(option->cmd == C_NEXT) {
      ++(*operation_index);
    }

    if(option_takes_value(option->desc)) {
      break;
    }
  }

  return 0;
}

int curlparse_scan_events(
  const char *const *argv,
  size_t argc,
  struct CurlparseEventScan *out
)
{
  struct EventBuilder builder;
  unsigned operation_index = 0;
  size_t i;
  bool positional_only = false;

  if(!argv || !out) {
    return -1;
  }

  memset(out, 0, sizeof(*out));
  memset(&builder, 0, sizeof(builder));

  for(i = 1; i < argc; ++i) {
    const char *token = argv[i];
    int rc;

    if(!token) {
      continue;
    }

    if(positional_only) {
      if(record_positional(&builder, operation_index, (unsigned)i, token) != 0) {
        goto fail;
      }
      continue;
    }

    if(strcmp(token, "--") == 0) {
      positional_only = true;
      continue;
    }

    if(token[0] != '-' || token[1] == '\0') {
      if(record_positional(&builder, operation_index, (unsigned)i, token) != 0) {
        goto fail;
      }
      continue;
    }

    if(token[1] == '-') {
      rc = scan_long_option(&builder, token, &operation_index, (unsigned)i,
                            argv, argc, &i);
      if(rc < 0) {
        goto fail;
      }
      if(rc > 0) {
        positional_only = true;
      }
      continue;
    }

    if(scan_short_option_bundle(&builder, token, &operation_index, (unsigned)i,
                                argv, argc, &i) != 0) {
      goto fail;
    }
  }

  out->events = builder.events;
  out->event_count = builder.count;
  return 0;

fail:
  free(builder.events);
  return -1;
}

void curlparse_event_scan_free(struct CurlparseEventScan *scan)
{
  if(!scan) {
    return;
  }
  free(scan->events);
  memset(scan, 0, sizeof(*scan));
}
