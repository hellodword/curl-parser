#include "api/curlparse_result.h"

#include <stdarg.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "runtime/curlparse_stub_contract.h"

const char *param2text(ParameterError error);

struct StringBuilder {
  char *data;
  size_t length;
  size_t capacity;
};

static int sb_reserve(struct StringBuilder *sb, size_t extra)
{
  char *grown;
  size_t required = sb->length + extra + 1;
  size_t new_capacity = sb->capacity ? sb->capacity : 256;

  if(required <= sb->capacity) {
    return 0;
  }

  while(new_capacity < required) {
    new_capacity *= 2;
  }

  grown = realloc(sb->data, new_capacity);
  if(!grown) {
    return -1;
  }

  sb->data = grown;
  sb->capacity = new_capacity;
  return 0;
}

static int sb_append_raw(
  struct StringBuilder *sb,
  const char *text,
  size_t text_len
)
{
  if(sb_reserve(sb, text_len) != 0) {
    return -1;
  }

  memcpy(sb->data + sb->length, text, text_len);
  sb->length += text_len;
  sb->data[sb->length] = '\0';
  return 0;
}

static int sb_append(struct StringBuilder *sb, const char *text)
{
  return sb_append_raw(sb, text, strlen(text));
}

static int sb_appendf(struct StringBuilder *sb, const char *fmt, ...)
{
  va_list args;
  va_list copy;
  int needed;

  va_start(args, fmt);
  va_copy(copy, args);
  needed = vsnprintf(NULL, 0, fmt, copy);
  va_end(copy);
  if(needed < 0) {
    va_end(args);
    return -1;
  }

  if(sb_reserve(sb, (size_t)needed) != 0) {
    va_end(args);
    return -1;
  }

  vsnprintf(sb->data + sb->length, sb->capacity - sb->length, fmt, args);
  va_end(args);
  sb->length += (size_t)needed;
  return 0;
}

static int sb_append_json_string(struct StringBuilder *sb, const char *text)
{
  const unsigned char *cursor = (const unsigned char *)text;

  if(sb_append_raw(sb, "\"", 1) != 0) {
    return -1;
  }

  while(cursor && *cursor) {
    switch(*cursor) {
    case '\\':
      if(sb_append(sb, "\\\\") != 0) {
        return -1;
      }
      break;
    case '"':
      if(sb_append(sb, "\\\"") != 0) {
        return -1;
      }
      break;
    case '\b':
      if(sb_append(sb, "\\b") != 0) {
        return -1;
      }
      break;
    case '\f':
      if(sb_append(sb, "\\f") != 0) {
        return -1;
      }
      break;
    case '\n':
      if(sb_append(sb, "\\n") != 0) {
        return -1;
      }
      break;
    case '\r':
      if(sb_append(sb, "\\r") != 0) {
        return -1;
      }
      break;
    case '\t':
      if(sb_append(sb, "\\t") != 0) {
        return -1;
      }
      break;
    default:
      if(*cursor < 0x20) {
        if(sb_appendf(sb, "\\u%04x", *cursor) != 0) {
          return -1;
        }
      }
      else if(sb_append_raw(sb, (const char *)cursor, 1) != 0) {
        return -1;
      }
      break;
    }
    ++cursor;
  }

  return sb_append_raw(sb, "\"", 1);
}

static int sb_append_json_string_n(
  struct StringBuilder *sb,
  const char *text,
  size_t length
)
{
  char *copy;
  int rc;

  copy = malloc(length + 1U);
  if(!copy) {
    return -1;
  }
  memcpy(copy, text, length);
  copy[length] = '\0';
  rc = sb_append_json_string(sb, copy);
  free(copy);
  return rc;
}

static int append_string_array(
  struct StringBuilder *sb,
  const char *const *items,
  size_t count
)
{
  size_t i;

  if(sb_append_raw(sb, "[", 1) != 0) {
    return -1;
  }

  for(i = 0; i < count; ++i) {
    if(i && sb_append_raw(sb, ",", 1) != 0) {
      return -1;
    }
    if(sb_append_json_string(sb, items[i]) != 0) {
      return -1;
    }
  }

  return sb_append_raw(sb, "]", 1);
}

static int append_nullable_json_string(
  struct StringBuilder *sb,
  const char *text
);

static int append_runtime_profile(
  struct StringBuilder *sb,
  const struct CurlparseProfile *profile
)
{
  if(sb_append(sb, "{") != 0 ||
     sb_append(sb, "\"schemaVersion\":\"curl-runtime-profile/v1\",") != 0 ||
     sb_append(sb, "\"curlVersion\":") != 0 ||
     sb_append_json_string(sb, profile->curl_version ? profile->curl_version : "") != 0 ||
     sb_append(sb, ",\"protocols\":") != 0 ||
     append_string_array(sb, profile->protocols, profile->protocol_count) != 0 ||
     sb_append(sb, ",\"features\":") != 0 ||
     append_string_array(sb, profile->features, profile->feature_count) != 0 ||
     sb_append(sb, ",\"compile\":{\"availableOptions\":") != 0) {
    return -1;
  }

  if(profile->available_options_is_set) {
    if(append_string_array(sb,
                           profile->available_options,
                           profile->available_option_count) != 0) {
      return -1;
    }
  }
  else if(sb_append(sb, "null") != 0) {
    return -1;
  }

  if(sb_append(sb, ",\"disabledOptions\":") != 0 ||
     append_string_array(sb,
                         profile->disabled_options,
                         profile->disabled_option_count) != 0 ||
     sb_append(sb, ",\"defines\":") != 0 ||
     append_string_array(sb, profile->defines, profile->define_count) != 0 ||
     sb_append(sb, "},\"optionCatalog\":{") != 0 ||
     sb_append(sb, "\"curlVersion\":") != 0 ||
     sb_append_json_string(sb,
                           profile->option_catalog_curl_version ?
                             profile->option_catalog_curl_version : "") != 0 ||
     sb_append(sb, ",\"source\":") != 0 ||
     sb_append_json_string(sb,
                           profile->option_catalog_source ?
                             profile->option_catalog_source : "") != 0 ||
     sb_append(sb, ",\"sha256\":") != 0 ||
     sb_append_json_string(sb,
                           profile->option_catalog_sha256 ?
                             profile->option_catalog_sha256 : "") != 0 ||
     sb_append(sb, "},\"sslBackend\":") != 0 ||
     append_nullable_json_string(sb, profile->ssl_backend) != 0 ||
     sb_append(sb, ",\"http3Backend\":") != 0 ||
     append_nullable_json_string(sb, profile->http3_backend) != 0 ||
     sb_append(sb, ",\"resolverBackend\":") != 0 ||
     append_nullable_json_string(sb, profile->resolver_backend) != 0 ||
     sb_append(sb, ",\"defaults\":{\"userAgent\":") != 0 ||
     append_nullable_json_string(sb, profile->default_user_agent) != 0 ||
     sb_append(sb, ",\"httpVersion\":") != 0) {
    return -1;
  }

  if(profile->default_http_version_is_set) {
    if(sb_appendf(sb, "%ld", profile->default_http_version) != 0) {
      return -1;
    }
  }
  else if(sb_append(sb, "null") != 0) {
    return -1;
  }

  if(sb_appendf(sb,
                ",\"followRedirects\":%s}",
                (profile->default_follow_redirects_is_set &&
                 profile->default_follow_redirects) ? "true" : "false") != 0) {
    return -1;
  }

  return sb_append(sb, "}");
}

static int append_nullable_json_string(
  struct StringBuilder *sb,
  const char *text
)
{
  if(!text) {
    return sb_append(sb, "null");
  }

  return sb_append_json_string(sb, text);
}

static int append_events(
  struct StringBuilder *sb,
  const struct CurlparseEventScan *scan
)
{
  size_t i;

  if(sb_append(sb, "[") != 0) {
    return -1;
  }

  for(i = 0; i < scan->event_count; ++i) {
    const struct CurlparseOptionEvent *event = &scan->events[i];

    if(i && sb_append(sb, ",") != 0) {
      return -1;
    }

    if(sb_appendf(sb,
                  "{\"operation\":%u,\"argvIndex\":%u,"
                  "\"rawFlag\":",
                  event->operation_index,
                  event->argv_index) != 0 ||
       append_nullable_json_string(sb, event->raw_flag) != 0 ||
       sb_append(sb, ",\"canonical\":") != 0 ||
       append_nullable_json_string(sb, event->canonical) != 0 ||
       sb_append(sb, ",\"value\":") != 0 ||
       append_nullable_json_string(sb, event->value) != 0 ||
       sb_append(sb, ",\"valueArgvIndex\":") != 0) {
      return -1;
    }

    if(event->has_value) {
      if(sb_appendf(sb, "%u", event->value_argv_index) != 0) {
        return -1;
      }
    }
    else if(sb_append(sb, "null") != 0) {
      return -1;
    }

    if(sb_appendf(sb,
                  ",\"usedNextArg\":%s,"
                  "\"negated\":%s,"
                  "\"isNext\":%s,"
                  "\"isPositional\":%s}",
                  event->used_nextarg ? "true" : "false",
                  event->negated ? "true" : "false",
                  event->is_next ? "true" : "false",
                  event->is_positional ? "true" : "false") != 0) {
      return -1;
    }
  }

  return sb_append(sb, "]");
}

static int append_guard_message_object(
  struct StringBuilder *sb,
  const struct CurlparseGuardMessage *item
)
{
  if(sb_append(sb, "{") != 0 ||
     sb_append(sb, "\"code\":") != 0 ||
     sb_append_json_string(sb, item->code ? item->code : "") != 0 ||
     sb_append(sb, ",\"option\":") != 0 ||
     append_nullable_json_string(sb, item->option) != 0 ||
     sb_append(sb, ",\"detail\":") != 0 ||
     append_nullable_json_string(sb, item->detail) != 0 ||
     sb_appendf(sb, ",\"warning\":%s}",
                item->warning ? "true" : "false") != 0) {
    return -1;
  }

  return 0;
}

static int append_guard_messages(
  struct StringBuilder *sb,
  const struct CurlparseGuardMessage *items,
  size_t count
)
{
  size_t i;

  if(sb_append(sb, "[") != 0) {
    return -1;
  }

  for(i = 0; i < count; ++i) {
    if(i && sb_append(sb, ",") != 0) {
      return -1;
    }

    if(append_guard_message_object(sb, &items[i]) != 0) {
      return -1;
    }
  }

  return sb_append(sb, "]");
}

static bool stub_contract_warns(const struct CurlparseStubContract *contract)
{
  return contract &&
    (strcmp(contract->level, "approximated") == 0 ||
     strcmp(contract->level, "forbidden-io") == 0 ||
     strcmp(contract->level, "unimplemented-loud") == 0);
}

static const char *stub_warning_code(const struct CurlparseStubContract *contract)
{
  if(!contract) {
    return "W_RUNTIME_STUB_USED";
  }
  if(strcmp(contract->level, "approximated") == 0) {
    return "W_RUNTIME_STUB_APPROXIMATED";
  }
  if(strcmp(contract->level, "forbidden-io") == 0) {
    return "E_RUNTIME_STUB_FORBIDDEN_IO";
  }
  if(strcmp(contract->level, "unimplemented-loud") == 0) {
    return "E_RUNTIME_STUB_UNIMPLEMENTED";
  }
  return "W_RUNTIME_STUB_USED";
}

static int append_stub_diagnostic(
  struct StringBuilder *sb,
  const struct CurlparseStubContract *contract
)
{
  if(sb_append(sb, "{\"code\":") != 0 ||
     sb_append_json_string(sb, stub_warning_code(contract)) != 0 ||
     sb_append(sb, ",\"option\":null,\"detail\":") != 0 ||
     sb_append_json_string(sb, contract && contract->summary ?
                           contract->summary : "Runtime stub used") != 0 ||
     sb_append(sb, ",\"warning\":true}") != 0) {
    return -1;
  }
  return 0;
}

static int append_diagnostics_with_stubs(
  struct StringBuilder *sb,
  const struct CurlparseGuardMessage *items,
  size_t count
)
{
  size_t i;
  bool first = true;

  if(sb_append(sb, "[") != 0) {
    return -1;
  }

  for(i = 0; i < count; ++i) {
    if(!first && sb_append(sb, ",") != 0) {
      return -1;
    }
    if(append_guard_message_object(sb, &items[i]) != 0) {
      return -1;
    }
    first = false;
  }

  for(i = 0; i < curlparse_stub_contract_used_count(); ++i) {
    const struct CurlparseStubContract *contract = curlparse_stub_contract_used(i);
    if(!stub_contract_warns(contract)) {
      continue;
    }
    if(!first && sb_append(sb, ",") != 0) {
      return -1;
    }
    if(append_stub_diagnostic(sb, contract) != 0) {
      return -1;
    }
    first = false;
  }

  return sb_append(sb, "]");
}

static int append_argv_source_span(
  struct StringBuilder *sb,
  const struct CurlparseInput *input,
  unsigned argv_index
)
{
  const char *value = (input && argv_index < input->argv_count) ?
    input->argv[argv_index] : "";
  return sb_appendf(sb,
                    "{\"source\":\"argv\",\"argvIndex\":%u,"
                    "\"start\":0,\"end\":%zu}",
                    argv_index,
                    strlen(value ? value : ""));
}

static int append_external_ref_source(
  struct StringBuilder *sb,
  const struct CurlparseExternalRef *ref,
  const struct CurlparseInput *input
)
{
  if(!ref || !ref->has_argv_index) {
    return sb_append(sb, "null");
  }

  return append_argv_source_span(sb, input, ref->argv_index);
}

static int append_external_refs(
  struct StringBuilder *sb,
  const struct CurlparseExternalRefs *refs,
  const struct CurlparseInput *input
)
{
  size_t i;

  if(sb_append(sb, "[") != 0) {
    return -1;
  }

  if(refs) {
    for(i = 0; i < refs->count; ++i) {
      const struct CurlparseExternalRef *ref = &refs->items[i];
      if(i && sb_append(sb, ",") != 0) {
        return -1;
      }
      if(sb_append(sb, "{\"id\":") != 0 ||
         sb_append_json_string(sb, ref->id ? ref->id : "") != 0 ||
         sb_append(sb, ",\"kind\":") != 0 ||
         sb_append_json_string(sb, ref->kind ? ref->kind : "") != 0 ||
         sb_append(sb, ",\"access\":") != 0 ||
         sb_append_json_string(sb, ref->access ? ref->access : "") != 0 ||
         sb_append(sb, ",\"option\":") != 0 ||
         append_nullable_json_string(sb, ref->option) != 0 ||
         sb_append(sb, ",\"value\":") != 0 ||
         append_nullable_json_string(sb, ref->value) != 0 ||
         sb_append(sb, ",\"source\":") != 0 ||
         append_external_ref_source(sb, ref, input) != 0 ||
         sb_append(sb, "}") != 0) {
        return -1;
      }
    }
  }

  return sb_append(sb, "]");
}

static const char *external_ref_id_for_event(
  const struct CurlparseExternalRefs *refs,
  const struct CurlparseOptionEvent *event,
  const char *value
)
{
  const struct CurlparseExternalRef *ref;

  if(!event) {
    return NULL;
  }

  ref = curlparse_external_refs_find(refs,
                                     event->raw_flag ?
                                       event->raw_flag : event->canonical,
                                     value ? value : event->value,
                                     event->has_value ?
                                       event->value_argv_index :
                                       event->argv_index,
                                     true);
  if(ref) {
    return ref->id;
  }

  ref = curlparse_external_refs_find(refs,
                                     event->canonical,
                                     value ? value : event->value,
                                     event->has_value ?
                                       event->value_argv_index :
                                       event->argv_index,
                                     true);
  if(ref) {
    return ref->id;
  }

  if(refs) {
    size_t i;
    unsigned argv_index = event->has_value ?
      event->value_argv_index : event->argv_index;
    for(i = 0; i < refs->count; ++i) {
      ref = &refs->items[i];
      if(ref->has_argv_index &&
         ref->argv_index == argv_index &&
         ((event->raw_flag && ref->option &&
           strcmp(ref->option, event->raw_flag) == 0) ||
          (event->canonical && ref->option &&
           strcmp(ref->option, event->canonical) == 0))) {
        return ref->id;
      }
    }
  }

  return NULL;
}

static bool event_in_group(
  const struct CurlparseOptionEvent *event,
  unsigned group_index
)
{
  return event && event->operation_index == group_index;
}

static bool cookie_value_is_file(const char *value)
{
  return value && value[0] && strchr(value, '=') == NULL;
}

static const struct CurlparseOptionEvent *find_group_event(
  const struct CurlparseEventScan *scan,
  unsigned group_index,
  const char *canonical
)
{
  size_t i;

  if(!scan || !canonical) {
    return NULL;
  }

  for(i = 0; i < scan->event_count; ++i) {
    const struct CurlparseOptionEvent *event = &scan->events[i];
    if(event_in_group(event, group_index) &&
       event->canonical &&
       strcmp(event->canonical, canonical) == 0) {
      return event;
    }
  }

  return NULL;
}

struct CurlparseResolvedUrl {
  const char *scheme;
  size_t scheme_len;
  const char *source;
};

static const char *hostname_prefix_scheme(const char *url, size_t *scheme_len)
{
  if(strncmp(url, "ftp.", 4U) == 0) {
    *scheme_len = 3U;
    return "ftp";
  }
  if(strncmp(url, "dict.", 5U) == 0) {
    *scheme_len = 4U;
    return "dict";
  }
  if(strncmp(url, "ldap.", 5U) == 0) {
    *scheme_len = 4U;
    return "ldap";
  }
  if(strncmp(url, "imap.", 5U) == 0) {
    *scheme_len = 4U;
    return "imap";
  }
  if(strncmp(url, "smtp.", 5U) == 0) {
    *scheme_len = 4U;
    return "smtp";
  }
  if(strncmp(url, "pop3.", 5U) == 0) {
    *scheme_len = 4U;
    return "pop3";
  }
  return NULL;
}

static struct CurlparseResolvedUrl resolve_transfer_url(
  const char *url,
  const struct CurlparseEventScan *scan,
  unsigned group_index
)
{
  struct CurlparseResolvedUrl result = {NULL, 0U, NULL};
  const struct CurlparseOptionEvent *proto_default;
  const char *prefix_scheme;
  size_t prefix_scheme_len = 0U;

  if(strstr(url, "://")) {
    return result;
  }

  proto_default = find_group_event(scan, group_index, "proto-default");
  if(proto_default && proto_default->value) {
    size_t scheme_len = strlen(proto_default->value);
    if(scheme_len > 0U) {
      result.scheme = proto_default->value;
      result.scheme_len = scheme_len;
      result.source = "proto-default";
      return result;
    }
  }

  prefix_scheme = hostname_prefix_scheme(url, &prefix_scheme_len);
  if(prefix_scheme) {
    result.scheme = prefix_scheme;
    result.scheme_len = prefix_scheme_len;
    result.source = "hostname-prefix";
    return result;
  }

  result.scheme = "http";
  result.scheme_len = 4U;
  result.source = "curl-default";
  return result;
}

static char *make_normalized_url(
  const char *raw_url,
  const struct CurlparseResolvedUrl *resolution
)
{
  char *normalized;
  size_t raw_len;
  size_t len;

  raw_len = strlen(raw_url);
  len = resolution->scheme_len + 3U + raw_len;
  normalized = malloc(len + 1U);
  if(!normalized) {
    return NULL;
  }

  memcpy(normalized, resolution->scheme, resolution->scheme_len);
  normalized[resolution->scheme_len] = ':';
  normalized[resolution->scheme_len + 1U] = '/';
  normalized[resolution->scheme_len + 2U] = '/';
  memcpy(normalized + resolution->scheme_len + 3U, raw_url, raw_len);
  normalized[len] = '\0';
  return normalized;
}

static int append_lower_scheme_json_string(
  struct StringBuilder *sb,
  const char *scheme,
  size_t scheme_len
)
{
  char *out;

  if(sb_reserve(sb, scheme_len + 2U) != 0) {
    return -1;
  }
  out = sb->data + sb->length;
  *out++ = '"';
  memcpy(out, scheme, scheme_len);
  out += scheme_len;
  *out++ = '"';
  *out = '\0';
  sb->length += scheme_len + 2U;
  return 0;
}

static int append_url_resolution_fields(
  struct StringBuilder *sb,
  const char *raw_url,
  const char *normalized_url,
  const struct CurlparseResolvedUrl *resolution
)
{
  if(!resolution->source) {
    return 0;
  }

  if(sb_append(sb, ",\"rawUrl\":") != 0 ||
     sb_append_json_string(sb, raw_url) != 0 ||
     sb_append(sb, ",\"urlResolution\":{\"scheme\":") != 0 ||
     append_lower_scheme_json_string(sb,
                                     resolution->scheme,
                                     resolution->scheme_len) != 0 ||
     sb_append(sb, ",\"source\":") != 0 ||
     sb_append_json_string(sb, resolution->source) != 0 ||
     sb_append(sb, ",\"normalized\":") != 0 ||
     sb_append_json_string(sb, normalized_url) != 0 ||
     sb_append(sb, "}") != 0) {
    return -1;
  }

  return 0;
}

static const char *body_kind_for_event(
  const struct CurlparseOptionEvent *event
)
{
  if(!event || !event->canonical) {
    return NULL;
  }
  if(strcmp(event->canonical, "data") == 0) {
    return "data";
  }
  if(strcmp(event->canonical, "data-raw") == 0) {
    return "data-raw";
  }
  if(strcmp(event->canonical, "data-binary") == 0) {
    return "data-binary";
  }
  if(strcmp(event->canonical, "data-urlencode") == 0) {
    return "data-urlencode";
  }
  if(strcmp(event->canonical, "json") == 0) {
    return "json";
  }
  if(strcmp(event->canonical, "form") == 0) {
    return "form";
  }
  if(strcmp(event->canonical, "form-string") == 0) {
    return "form-string";
  }
  if(strcmp(event->canonical, "upload-file") == 0) {
    return "upload-file";
  }
  return NULL;
}

static const struct CurlparseOptionEvent *find_body_event(
  const struct CurlparseEventScan *scan,
  unsigned group_index
)
{
  size_t i;

  if(!scan) {
    return NULL;
  }

  for(i = 0; i < scan->event_count; ++i) {
    const struct CurlparseOptionEvent *event = &scan->events[i];
    if(event_in_group(event, group_index) && body_kind_for_event(event)) {
      return event;
    }
  }

  return NULL;
}

static int append_ir_header_array(
  struct StringBuilder *sb,
  const struct CurlparseInput *input,
  const struct CurlparseEventScan *scan,
  const struct CurlparseExternalRefs *refs,
  unsigned group_index
)
{
  size_t i;
  bool first = true;

  if(sb_append(sb, "[") != 0) {
    return -1;
  }

  for(i = 0; i < scan->event_count; ++i) {
    const struct CurlparseOptionEvent *event = &scan->events[i];
    const char *raw;
    const char *colon;
    const char *value;
    size_t name_len;

    if(!event_in_group(event, group_index) ||
       !event->canonical ||
       strcmp(event->canonical, "header") != 0 ||
       !event->value) {
      continue;
    }

    raw = event->value;
    if(raw[0] == '@') {
      const char *ref_id = external_ref_id_for_event(refs, event, raw + 1);
      if(!first && sb_append(sb, ",") != 0) {
        return -1;
      }
      if(sb_append(sb, "{\"kind\":\"external\",\"externalRefId\":") != 0 ||
         append_nullable_json_string(sb, ref_id) != 0 ||
         sb_append(sb, ",\"source\":") != 0 ||
         append_argv_source_span(sb, input, event->value_argv_index) != 0 ||
         sb_append(sb, "}") != 0) {
        return -1;
      }
      first = false;
      continue;
    }

    colon = strchr(raw, ':');
    name_len = colon ? (size_t)(colon - raw) : strlen(raw);
    value = colon ? colon + 1 : "";
    while(*value == ' ' || *value == '\t') {
      ++value;
    }

    if(!first && sb_append(sb, ",") != 0) {
      return -1;
    }
    if(sb_append(sb, "{\"name\":") != 0 ||
       sb_append_json_string_n(sb, raw, name_len) != 0 ||
       sb_append(sb, ",\"value\":") != 0 ||
       sb_append_json_string(sb, value) != 0 ||
       sb_append(sb, ",\"raw\":") != 0 ||
       sb_append_json_string(sb, raw) != 0 ||
       sb_append(sb, ",\"source\":") != 0 ||
       append_argv_source_span(sb, input, event->value_argv_index) != 0 ||
       sb_append(sb, "}") != 0) {
      return -1;
    }
    first = false;
  }

  return sb_append(sb, "]");
}

static int append_ir_cookie_array(
  struct StringBuilder *sb,
  const struct CurlparseEventScan *scan,
  const struct CurlparseExternalRefs *refs,
  unsigned group_index
)
{
  size_t i;
  bool first = true;

  if(sb_append(sb, "[") != 0) {
    return -1;
  }

  for(i = 0; i < scan->event_count; ++i) {
    const struct CurlparseOptionEvent *event = &scan->events[i];
    if(!event_in_group(event, group_index) ||
       !event->canonical ||
       strcmp(event->canonical, "cookie") != 0 ||
       !event->value) {
      continue;
    }
    if(!first && sb_append(sb, ",") != 0) {
      return -1;
    }
    if(cookie_value_is_file(event->value)) {
      const char *ref_id = external_ref_id_for_event(refs, event, event->value);
      if(sb_append(sb, "{\"kind\":\"file\",\"value\":") != 0 ||
         sb_append_json_string(sb, event->value) != 0 ||
         sb_append(sb, ",\"externalRefId\":") != 0 ||
         append_nullable_json_string(sb, ref_id) != 0 ||
         sb_append(sb, "}") != 0) {
        return -1;
      }
    }
    else if(sb_append(sb, "{\"kind\":\"header\",\"value\":") != 0 ||
            sb_append_json_string(sb, event->value) != 0 ||
            sb_append(sb, "}") != 0) {
      return -1;
    }
    first = false;
  }

  return sb_append(sb, "]");
}

static int append_ir_body(
  struct StringBuilder *sb,
  const struct CurlparseInput *input,
  const struct CurlparseEventScan *scan,
  const struct CurlparseExternalRefs *refs,
  unsigned group_index
)
{
  const struct CurlparseOptionEvent *event = find_body_event(scan, group_index);
  const char *kind = body_kind_for_event(event);

  if(!event || !kind) {
    return sb_append(sb, "null");
  }

  if(sb_append(sb, "{\"kind\":") != 0 ||
     sb_append_json_string(sb, kind) != 0 ||
     sb_append(sb, ",\"value\":") != 0 ||
     append_nullable_json_string(sb, event->value) != 0 ||
     sb_append(sb, ",\"source\":") != 0 ||
     append_argv_source_span(sb, input, event->value_argv_index) != 0) {
    return -1;
  }

  {
    const char *ref_value = event->value;
    const char *ref_id = NULL;

    if(ref_value && ref_value[0] == '@') {
      ref_value = ref_value + 1;
    }
    ref_id = external_ref_id_for_event(refs, event, ref_value);
    if(ref_id &&
       (sb_append(sb, ",\"externalRefId\":") != 0 ||
        sb_append_json_string(sb, ref_id) != 0)) {
      return -1;
    }
  }

  return sb_append(sb, "}");
}

static int append_ir_method(
  struct StringBuilder *sb,
  const struct CurlparseInput *input,
  const struct CurlparseEventScan *scan,
  unsigned group_index
)
{
  const struct CurlparseOptionEvent *request = find_group_event(scan, group_index, "request");
  const struct CurlparseOptionEvent *head = find_group_event(scan, group_index, "head");
  const struct CurlparseOptionEvent *body = find_body_event(scan, group_index);
  const char *method = "GET";
  const char *source = "default";
  const struct CurlparseOptionEvent *source_event = NULL;

  if(request && request->value) {
    method = request->value;
    source = "flag";
    source_event = request;
  }
  else if(head) {
    method = "HEAD";
    source = "flag";
    source_event = head;
  }
  else if(body) {
    method = "POST";
    source = "body";
    source_event = body;
  }

  if(sb_append(sb, "{\"value\":") != 0 ||
     sb_append_json_string(sb, method) != 0 ||
     sb_append(sb, ",\"source\":") != 0 ||
     sb_append_json_string(sb, source) != 0) {
    return -1;
  }

  if(source_event) {
    unsigned index = source_event->has_value ?
      source_event->value_argv_index : source_event->argv_index;
    if(sb_append(sb, ",\"sourceSpan\":") != 0 ||
       append_argv_source_span(sb, input, index) != 0) {
      return -1;
    }
  }

  return sb_append(sb, "}");
}

static const char *http_version_for_group(
  const struct CurlparseEventScan *scan,
  unsigned group_index
)
{
  if(find_group_event(scan, group_index, "http1.0")) {
    return "1.0";
  }
  if(find_group_event(scan, group_index, "http1.1")) {
    return "1.1";
  }
  if(find_group_event(scan, group_index, "http2")) {
    return "2";
  }
  if(find_group_event(scan, group_index, "http3") ||
     find_group_event(scan, group_index, "http3-only")) {
    return "3";
  }
  return NULL;
}

static int append_ir_proxy(
  struct StringBuilder *sb,
  const struct CurlparseEventScan *scan,
  unsigned group_index
)
{
  const struct CurlparseOptionEvent *proxy = find_group_event(scan, group_index, "proxy");
  if(!proxy || !proxy->value) {
    return sb_append(sb, "null");
  }
  return sb_append(sb, "{\"url\":") != 0 ||
    sb_append_json_string(sb, proxy->value) != 0 ||
    sb_append(sb, "}") != 0 ? -1 : 0;
}

static int append_ir_effective(
  struct StringBuilder *sb,
  const struct CurlparseInput *input,
  const struct CurlparseEventScan *scan,
  const struct CurlparseExternalRefs *refs,
  unsigned group_index
)
{
  const char *http_version = http_version_for_group(scan, group_index);
  const struct CurlparseOptionEvent *user = find_group_event(scan, group_index, "user");
  const struct CurlparseOptionEvent *insecure = find_group_event(scan, group_index, "insecure");

  if(sb_append(sb, "{\"method\":") != 0 ||
     append_ir_method(sb, input, scan, group_index) != 0 ||
     sb_append(sb, ",\"headers\":") != 0 ||
     append_ir_header_array(sb, input, scan, refs, group_index) != 0 ||
     sb_append(sb, ",\"body\":") != 0 ||
     append_ir_body(sb, input, scan, refs, group_index) != 0 ||
     sb_append(sb, ",\"auth\":{") != 0) {
    return -1;
  }

  if(user && user->value) {
    if(sb_append(sb, "\"scheme\":null,\"value\":") != 0 ||
       sb_append_json_string(sb, user->value) != 0 ||
       sb_append(sb, ",\"sensitive\":true") != 0) {
      return -1;
    }
  }

  if(sb_append(sb, "},\"cookies\":") != 0 ||
     append_ir_cookie_array(sb, scan, refs, group_index) != 0 ||
     sb_append(sb, ",\"proxy\":") != 0 ||
     append_ir_proxy(sb, scan, group_index) != 0 ||
     sb_append(sb, ",\"tls\":{") != 0 ||
     (insecure ? sb_append(sb, "\"verify\":false") : 0) != 0 ||
     sb_append(sb, "},\"httpVersion\":") != 0 ||
     append_nullable_json_string(sb, http_version) != 0 ||
     sb_append(sb, "}") != 0) {
    return -1;
  }

  return 0;
}

static unsigned count_groups(const struct CurlparseEventScan *scan)
{
  size_t i;
  unsigned groups = 1U;

  if(!scan) {
    return groups;
  }

  for(i = 0; i < scan->event_count; ++i) {
    if(scan->events[i].operation_index + 1U > groups) {
      groups = scan->events[i].operation_index + 1U;
    }
  }

  return groups;
}

static int append_ir_groups(
  struct StringBuilder *sb,
  const struct CurlparseInput *input,
  const struct CurlparseEventScan *scan,
  const struct CurlparseExternalRefs *refs
)
{
  unsigned group_count = count_groups(scan);
  unsigned group_index;
  unsigned transfer_index = 0U;

  if(sb_append(sb, "[") != 0) {
    return -1;
  }

  for(group_index = 0; group_index < group_count; ++group_index) {
    size_t i;
    bool first_transfer = true;

    if(group_index && sb_append(sb, ",") != 0) {
      return -1;
    }
    if(sb_appendf(sb,
                  "{\"id\":\"group-%u\",\"index\":%u,\"options\":{\"headers\":",
                  group_index,
                  group_index) != 0 ||
       append_ir_header_array(sb, input, scan, refs, group_index) != 0 ||
       sb_append(sb, "},\"transfers\":[") != 0) {
      return -1;
    }

    for(i = 0; i < scan->event_count; ++i) {
      const struct CurlparseOptionEvent *event = &scan->events[i];
      if(!event_in_group(event, group_index) ||
         !event->is_positional ||
         !event->value) {
        continue;
      }

      if(!first_transfer && sb_append(sb, ",") != 0) {
        return -1;
      }
      {
        struct CurlparseResolvedUrl resolution =
          resolve_transfer_url(event->value, scan, group_index);
        char *normalized_url = resolution.source ?
          make_normalized_url(event->value, &resolution) : NULL;
        const char *rendered_url = normalized_url ? normalized_url : event->value;

        if(resolution.source && !normalized_url) {
          return -1;
        }

        if(sb_appendf(sb,
                      "{\"id\":\"transfer-%u\",\"index\":%u,\"url\":",
                      transfer_index,
           transfer_index) != 0 ||
           sb_append_json_string(sb, rendered_url) != 0 ||
           append_url_resolution_fields(sb,
                                        event->value,
                                        rendered_url,
                                        &resolution) != 0 ||
           sb_append(sb, ",\"effective\":") != 0 ||
           append_ir_effective(sb, input, scan, refs, group_index) != 0 ||
           sb_append(sb, ",\"source\":") != 0 ||
           append_argv_source_span(sb, input, event->argv_index) != 0 ||
           (strncmp(rendered_url, "file://", 7U) == 0 ?
             sb_append(sb, ",\"protocol\":\"local-file\"") : 0) != 0 ||
           sb_append(sb, "}") != 0) {
          free(normalized_url);
          return -1;
        }
        free(normalized_url);
      }
      ++transfer_index;
      first_transfer = false;
    }

    if(sb_append(sb, "]}") != 0) {
      return -1;
    }
  }

  return sb_append(sb, "]");
}

static int append_ir(
  struct StringBuilder *sb,
  const struct CurlparseInput *input,
  const struct CurlparseEventScan *scan,
  const struct CurlparseExternalRefs *external_refs
)
{
  if(sb_append(sb, "{") != 0 ||
     sb_append(sb, "\"schemaVersion\":\"curl-ir/v1\",") != 0 ||
     sb_append(sb, "\"curlSourceVersion\":\"8.20.0\",") != 0 ||
     sb_append(sb, "\"command\":{\"inputMode\":\"argv\",\"argv\":") != 0 ||
     append_string_array(sb, input->argv, input->argv_count) != 0 ||
     sb_append(sb, "},\"externalRefs\":") != 0 ||
     append_external_refs(sb, external_refs, input) != 0 ||
     sb_append(sb, ",\"runtime\":{\"profile\":") != 0 ||
     append_runtime_profile(sb, &input->runtime_profile) != 0 ||
     sb_append(sb, "},\"globals\":{},\"groups\":") != 0 ||
     append_ir_groups(sb, input, scan, external_refs) != 0 ||
     sb_append(sb, ",\"diagnostics\":[]}") != 0) {
    return -1;
  }

  return 0;
}

int curlparse_render_success_result(
  const struct CurlparseInput *input,
  char **out_json,
  size_t *out_len
)
{
  struct StringBuilder sb;

  if(!input || !out_json || !out_len) {
    return -1;
  }

  memset(&sb, 0, sizeof(sb));

  if(sb_append(&sb, "{") != 0 ||
     sb_append(&sb, "\"ok\":true,") != 0 ||
     sb_append(&sb, "\"schemaVersion\":\"curl-parse-output/v1\",") != 0 ||
     sb_append(&sb, "\"curlSourceVersion\":\"8.20.0\",") != 0 ||
     sb_append(&sb, "\"runtimeProfileApplied\":") != 0 ||
     append_runtime_profile(&sb, &input->runtime_profile) != 0 ||
     sb_append(&sb, ",") != 0 ||
     sb_append(&sb, "\"argv\":") != 0 ||
     append_string_array(&sb, input->argv, input->argv_count) != 0 ||
     sb_append(&sb, ",\"operations\":[],") != 0 ||
     sb_append(&sb, "\"events\":[],") != 0 ||
     sb_append(&sb, "\"diagnostics\":[],") != 0 ||
     sb_append(&sb, "\"errors\":[]}") != 0) {
    free(sb.data);
    return -1;
  }

  *out_json = sb.data;
  *out_len = sb.length;
  return 0;
}

int curlparse_render_parse_result(
  const struct CurlparseInput *input,
  const struct CurlparseEventScan *scan,
  const char *operations_json,
  const struct CurlparseGuardReport *report,
  const struct CurlparseExternalRefs *external_refs,
  ParameterError parse_error,
  char **out_json,
  size_t *out_len
)
{
  struct StringBuilder sb;
  const char *parse_error_text = NULL;
  bool ok;

  if(!input || !scan || !operations_json || !report || !out_json || !out_len) {
    return -1;
  }

  memset(&sb, 0, sizeof(sb));
  parse_error_text = (parse_error == PARAM_OK) ? NULL : param2text(parse_error);
  ok = report->ok && (parse_error == PARAM_OK);

  if(sb_append(&sb, "{") != 0 ||
     sb_appendf(&sb, "\"ok\":%s,", ok ? "true" : "false") != 0 ||
     sb_append(&sb, "\"schemaVersion\":\"curl-parse-output/v1\",") != 0 ||
     sb_append(&sb, "\"curlSourceVersion\":\"8.20.0\",") != 0 ||
     sb_append(&sb, "\"runtimeProfileApplied\":") != 0 ||
     append_runtime_profile(&sb, &input->runtime_profile) != 0 ||
     sb_append(&sb, ",\"ir\":") != 0 ||
     append_ir(&sb, input, scan, external_refs) != 0 ||
     sb_append(&sb, ",\"argv\":") != 0 ||
     append_string_array(&sb, input->argv, input->argv_count) != 0 ||
     sb_append(&sb, ",\"operations\":") != 0 ||
     sb_append(&sb, operations_json) != 0 ||
     sb_append(&sb, ",\"events\":") != 0 ||
     append_events(&sb, scan) != 0 ||
     sb_append(&sb, ",\"diagnostics\":") != 0 ||
     append_diagnostics_with_stubs(&sb,
                                   report->diagnostics,
                                   report->diagnostic_count) != 0 ||
     sb_append(&sb, ",\"errors\":[") != 0) {
    free(sb.data);
    return -1;
  }

  if(parse_error != PARAM_OK) {
    struct CurlparseGuardMessage parse_error_item;

    memset(&parse_error_item, 0, sizeof(parse_error_item));
    parse_error_item.code = "parse-error";
    parse_error_item.detail = (char *)parse_error_text;
    if(append_guard_message_object(&sb, &parse_error_item) != 0) {
      free(sb.data);
      return -1;
    }
  }

  if(report->error_count) {
    size_t i;

    for(i = 0; i < report->error_count; ++i) {
      if((parse_error != PARAM_OK || i) && sb_append(&sb, ",") != 0) {
        free(sb.data);
        return -1;
      }
      if(append_guard_message_object(&sb, &report->errors[i]) != 0) {
        free(sb.data);
        return -1;
      }
    }
  }

  if(sb_append(&sb, "]}") != 0) {
    free(sb.data);
    return -1;
  }

  *out_json = sb.data;
  *out_len = sb.length;
  return 0;
}

int curlparse_render_input_error_result(
  const struct CurlparseJsonError *error,
  char **out_json,
  size_t *out_len
)
{
  struct StringBuilder sb;
  const char *code;
  const char *severity;
  const char *category;
  const char *message;
  const char *path;
  const char *expected;
  const char *actual;

  if(!out_json || !out_len) {
    return -1;
  }

  memset(&sb, 0, sizeof(sb));
  code = (error && error->code) ? error->code : "E_INPUT_SCHEMA_INVALID";
  severity = (error && error->severity) ? error->severity : "fatal";
  category = (error && error->category) ? error->category : "input";
  message = (error && error->message[0]) ? error->message : "Invalid input";
  path = (error && error->path[0]) ? error->path : "$";
  expected = (error && error->expected[0]) ? error->expected : "valid parse input JSON";
  actual = (error && error->actual[0]) ? error->actual : "";

  if(sb_append(&sb, "{") != 0 ||
     sb_append(&sb, "\"ok\":false,") != 0 ||
     sb_append(&sb, "\"schemaVersion\":\"curl-parse-output/v1\",") != 0 ||
     sb_append(&sb, "\"curlSourceVersion\":\"8.20.0\",") != 0 ||
     sb_append(&sb, "\"runtimeProfileApplied\":{") != 0 ||
     sb_append(&sb, "\"schemaVersion\":\"curl-runtime-profile/v1\",") != 0 ||
     sb_append(&sb, "\"curlVersion\":\"8.20.0\",") != 0 ||
     sb_append(&sb, "\"protocols\":[],\"features\":[]},") != 0 ||
     sb_append(&sb, "\"argv\":[],\"operations\":[],\"events\":[],") != 0 ||
     sb_append(&sb, "\"diagnostics\":[],\"errors\":[{") != 0 ||
     sb_append(&sb, "\"code\":") != 0 ||
     sb_append_json_string(&sb, code) != 0 ||
     sb_append(&sb, ",\"severity\":") != 0 ||
     sb_append_json_string(&sb, severity) != 0 ||
     sb_append(&sb, ",\"category\":") != 0 ||
     sb_append_json_string(&sb, category) != 0 ||
     sb_append(&sb, ",\"message\":") != 0 ||
     sb_append_json_string(&sb, message) != 0 ||
     sb_append(&sb, ",\"path\":") != 0 ||
     sb_append_json_string(&sb, path) != 0 ||
     sb_append(&sb, ",\"details\":{\"expected\":") != 0 ||
     sb_append_json_string(&sb, expected) != 0 ||
     sb_append(&sb, ",\"actual\":") != 0 ||
     sb_append_json_string(&sb, actual) != 0 ||
     sb_append(&sb, "}}]}") != 0) {
    free(sb.data);
    return -1;
  }

  *out_json = sb.data;
  *out_len = sb.length;
  return 0;
}
