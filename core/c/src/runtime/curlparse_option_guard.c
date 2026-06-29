#include "runtime/curlparse_option_guard.h"

#include <stdlib.h>
#include <string.h>

#include "curlparse/generated/curlparse_guards.h"

struct MessageBuilder {
  struct CurlparseGuardMessage *items;
  size_t count;
  size_t capacity;
};

static char *guard_strdup(const char *input)
{
  size_t size;
  char *copy;

  if(!input) {
    return NULL;
  }

  size = strlen(input) + 1U;
  copy = malloc(size);
  if(!copy) {
    return NULL;
  }

  memcpy(copy, input, size);
  return copy;
}

static int push_message(
  struct MessageBuilder *builder,
  const char *code,
  const char *option,
  const char *detail,
  bool warning
)
{
  struct CurlparseGuardMessage *grown;

  if(builder->count == builder->capacity) {
    size_t new_capacity = builder->capacity ? (builder->capacity * 2U) : 4U;
    grown = realloc(builder->items, new_capacity * sizeof(*grown));
    if(!grown) {
      return -1;
    }
    builder->items = grown;
    builder->capacity = new_capacity;
  }

  builder->items[builder->count].code = code;
  builder->items[builder->count].option = guard_strdup(option);
  builder->items[builder->count].detail = guard_strdup(detail);
  builder->items[builder->count].warning = warning;
  if((option && !builder->items[builder->count].option) ||
     (detail && !builder->items[builder->count].detail)) {
    free(builder->items[builder->count].option);
    free(builder->items[builder->count].detail);
    return -1;
  }

  ++builder->count;
  return 0;
}

static void free_builder(struct MessageBuilder *builder)
{
  size_t i;

  if(!builder) {
    return;
  }

  for(i = 0; i < builder->count; ++i) {
    free(builder->items[i].option);
    free(builder->items[i].detail);
  }
  free(builder->items);
  memset(builder, 0, sizeof(*builder));
}

static const struct CurlparseOptionGuard *find_option_guard(const char *option)
{
  size_t i;

  for(i = 0; i < sizeof(curlparse_guards) /
                 sizeof(curlparse_guards[0]); ++i) {
    if(strcmp(curlparse_guards[i].option, option) == 0) {
      return &curlparse_guards[i];
    }
  }

  return NULL;
}

static bool list_contains(const char *const *items, const char *value)
{
  size_t i;

  if(!items || !value) {
    return false;
  }

  for(i = 0; items[i]; ++i) {
    if(strcmp(items[i], value) == 0) {
      return true;
    }
  }

  return false;
}

static bool profile_protocol_available(
  const struct CurlparseProfile *profile,
  const char *protocol
)
{
  return curlparse_profile_has_protocol(profile, protocol);
}

static bool profile_feature_available(
  const struct CurlparseProfile *profile,
  const char *feature
)
{
  return curlparse_profile_has_feature(profile, feature);
}

static int add_option_not_available(
  struct MessageBuilder *errors,
  const char *option,
  const char *detail
)
{
  return push_message(errors, "option-not-available", option, detail, false);
}

static int add_option_disabled_by_profile(
  struct MessageBuilder *errors,
  const char *option
)
{
  return push_message(errors,
                      "E_CURL_OPTION_DISABLED_BY_PROFILE",
                      option,
                      "runtimeProfile.compile.disabledOptions",
                      false);
}

static const char *derive_disabled_option_from_define(const char *define_name)
{
  if(strcmp(define_name, "CURL_DISABLE_IPFS") == 0) {
    return "ipfs-gateway";
  }
  return NULL;
}

static const char *message_option_name(
  const struct CurlparseOptionEvent *event
)
{
  if(!event) {
    return NULL;
  }

  return event->raw_flag ? event->raw_flag : event->canonical;
}

static bool option_disabled_by_profile(
  const struct CurlparseProfile *profile,
  const char *option
)
{
  size_t i;
  const char *derived;

  if(!profile || !option) {
    return false;
  }

  for(i = 0; i < profile->disabled_option_count; ++i) {
    if(strcmp(profile->disabled_options[i], option) == 0) {
      return true;
    }
  }

  for(i = 0; i < profile->define_count; ++i) {
    derived = derive_disabled_option_from_define(profile->defines[i]);
    if(derived && strcmp(derived, option) == 0) {
      return true;
    }
  }

  if(!curlparse_profile_has_define(profile, "DEBUGBUILD") &&
     (strcmp(option, "test-duphandle") == 0 ||
      strcmp(option, "test-event") == 0) &&
     !curlparse_profile_option_available(profile, option)) {
    return true;
  }

  if(!curlparse_profile_has_define(profile, "USE_WATT32") &&
     strcmp(option, "wdebug") == 0 &&
     !curlparse_profile_option_available(profile, option)) {
    return true;
  }

  return false;
}

static const char *extract_scheme(const char *value, char *buffer, size_t size)
{
  const char *sep;
  size_t len;

  if(!value || !buffer || size < 2U) {
    return NULL;
  }

  sep = strstr(value, "://");
  if(!sep) {
    return NULL;
  }

  len = (size_t)(sep - value);
  if(len == 0 || len + 1U > size) {
    return NULL;
  }

  memcpy(buffer, value, len);
  buffer[len] = '\0';
  return buffer;
}

static int guard_event_option(
  const struct CurlparseProfile *profile,
  const struct CurlparseOptionEvent *event,
  const struct CurlparseEventScan *scan,
  struct MessageBuilder *diagnostics,
  struct MessageBuilder *errors
)
{
  const struct CurlparseOptionGuard *guard;
  size_t i;
  bool any_feature;
  char scheme_buffer[32];

  if(event->is_positional || !event->canonical) {
    return 0;
  }

  if(profile->available_options_is_set &&
     !curlparse_profile_option_available(profile, event->canonical)) {
    return add_option_not_available(errors, message_option_name(event),
                                    "runtimeProfile.compile availableOptions");
  }

  if(option_disabled_by_profile(profile, event->canonical)) {
    return add_option_disabled_by_profile(errors, message_option_name(event));
  }

  guard = find_option_guard(event->canonical);
  if(guard) {
    for(i = 0; guard->requires_features[i]; ++i) {
      if(!profile_feature_available(profile, guard->requires_features[i])) {
        return push_message(errors, "feature-not-available",
                            message_option_name(event),
                            guard->requires_features[i], false);
      }
    }

    if(guard->requires_any_features[0]) {
      any_feature = false;
      for(i = 0; guard->requires_any_features[i]; ++i) {
        if(profile_feature_available(profile, guard->requires_any_features[i])) {
          any_feature = true;
          break;
        }
      }
      if(!any_feature) {
        return push_message(errors, "feature-not-available",
                            message_option_name(event),
                            guard->requires_any_features[0], false);
      }
    }

    if((strcmp(event->canonical, "http3") == 0 ||
        strcmp(event->canonical, "http3-only") == 0) &&
       guard->requires_url_schemes[0]) {
      for(i = 0; i < scan->event_count; ++i) {
        const struct CurlparseOptionEvent *candidate = &scan->events[i];
        const char *scheme;
        if(candidate->operation_index != event->operation_index ||
           !candidate->is_positional) {
          continue;
        }
        scheme = extract_scheme(candidate->value, scheme_buffer, sizeof(scheme_buffer));
        if(scheme && !list_contains(guard->requires_url_schemes, scheme)) {
          return push_message(errors, "protocol-not-available",
                              message_option_name(event),
                              guard->requires_url_schemes[0], false);
        }
      }
    }
  }

  if(strcmp(event->canonical, "proxy") == 0 && event->value) {
    const char *scheme = extract_scheme(event->value, scheme_buffer, sizeof(scheme_buffer));
    if(scheme && strcmp(scheme, "https") == 0 &&
       !profile_feature_available(profile, "HTTPS-proxy")) {
      return push_message(errors, "feature-not-available",
                          message_option_name(event), "HTTPS-proxy", false);
    }
  }

  if(strcmp(event->canonical, "proto-default") == 0 && event->value) {
    if(strcmp(event->value, "ipfs") == 0 ||
       strcmp(event->value, "ipns") == 0 ||
       !profile_protocol_available(profile, event->value)) {
      return push_message(errors, "protocol-not-available",
                          message_option_name(event), event->value, false);
    }
  }

  if(strcmp(event->canonical, "proto") == 0 && event->value) {
    const char *cursor = event->value;
    char protocol[64];
    size_t length = 0;

    while(*cursor) {
      if(*cursor == '+' || *cursor == '-' || *cursor == '=') {
        ++cursor;
        continue;
      }
      if(*cursor == ',') {
        if(length) {
          protocol[length] = '\0';
          if(!profile_protocol_available(profile, protocol) &&
             push_message(diagnostics, "protocol-not-available",
                          message_option_name(event), protocol, true) != 0) {
            return -1;
          }
          length = 0;
        }
        ++cursor;
        continue;
      }
      if(length + 1U < sizeof(protocol)) {
        protocol[length++] = *cursor;
      }
      ++cursor;
    }

    if(length) {
      protocol[length] = '\0';
      if(!profile_protocol_available(profile, protocol) &&
         push_message(diagnostics, "protocol-not-available",
                      message_option_name(event), protocol, true) != 0) {
        return -1;
      }
    }
  }

  return 0;
}

static int guard_positional_url(
  const struct CurlparseProfile *profile,
  const struct CurlparseOptionEvent *event,
  struct MessageBuilder *errors
)
{
  char scheme_buffer[32];
  const char *scheme;

  if(!event->is_positional || !event->value) {
    return 0;
  }

  scheme = extract_scheme(event->value, scheme_buffer, sizeof(scheme_buffer));
  if(scheme && !profile_protocol_available(profile, scheme)) {
    return push_message(errors, "protocol-not-available",
                        NULL, scheme, false);
  }

  return 0;
}

int curlparse_apply_option_guards(
  const struct CurlparseProfile *profile,
  const struct CurlparseEventScan *scan,
  const char *parse_mode,
  struct CurlparseGuardReport *out
)
{
  struct CurlparseProfile default_profile;
  struct MessageBuilder diagnostics;
  struct MessageBuilder errors;
  size_t i;
  int rc;
  bool strict_mode = true;

  if(!scan || !out) {
    return -1;
  }

  memset(out, 0, sizeof(*out));
  memset(&diagnostics, 0, sizeof(diagnostics));
  memset(&errors, 0, sizeof(errors));

  if(!profile) {
    curlparse_profile_default(&default_profile);
    profile = &default_profile;
  }

  if(parse_mode && strcmp(parse_mode, "diagnostic") == 0) {
    strict_mode = false;
  }

  for(i = 0; i < scan->event_count; ++i) {
    rc = guard_event_option(profile, &scan->events[i], scan,
                            &diagnostics, &errors);
    if(rc != 0) {
      goto fail;
    }
    rc = guard_positional_url(profile, &scan->events[i], &errors);
    if(rc != 0) {
      goto fail;
    }
  }

  out->diagnostics = diagnostics.items;
  out->diagnostic_count = diagnostics.count;
  out->errors = errors.items;
  out->error_count = errors.count;
  out->ok = strict_mode ? (errors.count == 0) : true;
  return 0;

fail:
  free_builder(&diagnostics);
  free_builder(&errors);
  return -1;
}

void curlparse_guard_report_free(struct CurlparseGuardReport *report)
{
  struct MessageBuilder builder;

  if(!report) {
    return;
  }

  builder.items = report->diagnostics;
  builder.count = report->diagnostic_count;
  builder.capacity = report->diagnostic_count;
  free_builder(&builder);

  builder.items = report->errors;
  builder.count = report->error_count;
  builder.capacity = report->error_count;
  free_builder(&builder);

  memset(report, 0, sizeof(*report));
}
