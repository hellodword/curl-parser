#include "api/curlparse_result.h"

#include <stdarg.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

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

static int append_runtime_profile(
  struct StringBuilder *sb,
  const struct CurlparseProfile *profile
)
{
  if(sb_append(sb, "{") != 0 ||
     sb_append(sb, "\"curlVersion\":") != 0 ||
     sb_append_json_string(sb, profile->curl_version ? profile->curl_version : "") != 0 ||
     sb_append(sb, ",\"protocols\":") != 0 ||
     append_string_array(sb, profile->protocols, profile->protocol_count) != 0 ||
     sb_append(sb, ",\"features\":") != 0 ||
     append_string_array(sb, profile->features, profile->feature_count) != 0 ||
     sb_append(sb, "}") != 0) {
    return -1;
  }

  return 0;
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
     sb_append(&sb, "\"schemaVersion\":\"1.0\",") != 0 ||
     sb_append(&sb, "\"curlSourceVersion\":\"8.20.0\",") != 0 ||
     sb_append(&sb, "\"runtimeProfileApplied\":{") != 0 ||
     sb_append(&sb, "\"curlVersion\":\"8.20.0\",") != 0 ||
     sb_append(&sb, "\"protocols\":") != 0 ||
     append_string_array(&sb,
                         input->runtime_profile.protocols,
                         input->runtime_profile.protocol_count) != 0 ||
     sb_append(&sb, ",\"features\":") != 0 ||
     append_string_array(&sb,
                         input->runtime_profile.features,
                         input->runtime_profile.feature_count) != 0 ||
     sb_append(&sb, "},") != 0 ||
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
     sb_append(&sb, "\"schemaVersion\":\"1.0\",") != 0 ||
     sb_append(&sb, "\"curlSourceVersion\":\"8.20.0\",") != 0 ||
     sb_append(&sb, "\"runtimeProfileApplied\":") != 0 ||
     append_runtime_profile(&sb, &input->runtime_profile) != 0 ||
     sb_append(&sb, ",\"argv\":") != 0 ||
     append_string_array(&sb, input->argv, input->argv_count) != 0 ||
     sb_append(&sb, ",\"operations\":") != 0 ||
     sb_append(&sb, operations_json) != 0 ||
     sb_append(&sb, ",\"events\":") != 0 ||
     append_events(&sb, scan) != 0 ||
     sb_append(&sb, ",\"diagnostics\":") != 0 ||
     append_guard_messages(&sb,
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
