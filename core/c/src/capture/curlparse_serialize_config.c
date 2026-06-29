#include "capture/curlparse_serialize_config.h"

#include <stdarg.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "curlx/dynbuf.h"

struct JsonBuilder {
  char *data;
  size_t length;
  size_t capacity;
};

static int jb_reserve(struct JsonBuilder *builder, size_t extra)
{
  char *grown;
  size_t required = builder->length + extra + 1U;
  size_t capacity = builder->capacity ? builder->capacity : 256U;

  if(required <= builder->capacity) {
    return 0;
  }

  while(capacity < required) {
    capacity *= 2U;
  }

  grown = realloc(builder->data, capacity);
  if(!grown) {
    return -1;
  }

  builder->data = grown;
  builder->capacity = capacity;
  return 0;
}

static int jb_appendn(
  struct JsonBuilder *builder,
  const char *text,
  size_t length
)
{
  if(jb_reserve(builder, length) != 0) {
    return -1;
  }

  memcpy(builder->data + builder->length, text, length);
  builder->length += length;
  builder->data[builder->length] = '\0';
  return 0;
}

static int jb_append(struct JsonBuilder *builder, const char *text)
{
  return jb_appendn(builder, text, strlen(text));
}

static int jb_appendf(struct JsonBuilder *builder, const char *fmt, ...)
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

  if(jb_reserve(builder, (size_t)needed) != 0) {
    va_end(args);
    return -1;
  }

  vsnprintf(builder->data + builder->length,
            builder->capacity - builder->length, fmt, args);
  va_end(args);
  builder->length += (size_t)needed;
  return 0;
}

static int jb_append_json_string(
  struct JsonBuilder *builder,
  const char *text
)
{
  const unsigned char *cursor = (const unsigned char *)text;

  if(jb_appendn(builder, "\"", 1) != 0) {
    return -1;
  }

  while(cursor && *cursor) {
    switch(*cursor) {
    case '\\':
      if(jb_append(builder, "\\\\") != 0) {
        return -1;
      }
      break;
    case '"':
      if(jb_append(builder, "\\\"") != 0) {
        return -1;
      }
      break;
    case '\b':
      if(jb_append(builder, "\\b") != 0) {
        return -1;
      }
      break;
    case '\f':
      if(jb_append(builder, "\\f") != 0) {
        return -1;
      }
      break;
    case '\n':
      if(jb_append(builder, "\\n") != 0) {
        return -1;
      }
      break;
    case '\r':
      if(jb_append(builder, "\\r") != 0) {
        return -1;
      }
      break;
    case '\t':
      if(jb_append(builder, "\\t") != 0) {
        return -1;
      }
      break;
    default:
      if(*cursor < 0x20) {
        if(jb_appendf(builder, "\\u%04x", *cursor) != 0) {
          return -1;
        }
      }
      else if(jb_appendn(builder, (const char *)cursor, 1) != 0) {
        return -1;
      }
      break;
    }
    ++cursor;
  }

  return jb_appendn(builder, "\"", 1);
}

static int jb_append_json_nullable_string(
  struct JsonBuilder *builder,
  const char *text
)
{
  if(!text) {
    return jb_append(builder, "null");
  }
  return jb_append_json_string(builder, text);
}

static int append_slist_array(
  struct JsonBuilder *builder,
  const struct curl_slist *list
)
{
  const struct curl_slist *node;
  bool first = true;

  if(jb_append(builder, "[") != 0) {
    return -1;
  }

  for(node = list; node; node = node->next) {
    if(!first && jb_append(builder, ",") != 0) {
      return -1;
    }
    if(jb_append_json_string(builder, node->data ? node->data : "") != 0) {
      return -1;
    }
    first = false;
  }

  return jb_append(builder, "]");
}

static int append_urls(
  struct JsonBuilder *builder,
  const struct getout *url_list
)
{
  const struct getout *node;
  bool first = true;

  if(jb_append(builder, "[") != 0) {
    return -1;
  }

  for(node = url_list; node; node = node->next) {
    if(!node->url) {
      continue;
    }
    if(!first && jb_append(builder, ",") != 0) {
      return -1;
    }
    if(jb_append(builder, "{") != 0 ||
       jb_append(builder, "\"url\":") != 0 ||
       jb_append_json_nullable_string(builder, node->url) != 0 ||
       jb_append(builder, ",\"outfile\":") != 0 ||
       jb_append_json_nullable_string(builder, node->outfile) != 0 ||
       jb_append(builder, ",\"infile\":") != 0 ||
       jb_append_json_nullable_string(builder, node->infile) != 0 ||
       jb_appendf(builder, ",\"urlNumber\":%" CURL_FORMAT_CURL_OFF_T,
                  node->num) != 0 ||
       jb_appendf(builder,
                  ",\"flags\":{\"outSet\":%s,\"uploadSet\":%s,"
                  "\"useRemote\":%s,\"noGlob\":%s,\"outNull\":%s}}",
                  node->outset ? "true" : "false",
                  node->uploadset ? "true" : "false",
                  node->useremote ? "true" : "false",
                  node->noglob ? "true" : "false",
                  node->out_null ? "true" : "false") != 0) {
      return -1;
    }
    first = false;
  }

  return jb_append(builder, "]");
}

static int append_postdata(
  struct JsonBuilder *builder,
  const struct OperationConfig *config
)
{
  const char *value = curlx_dyn_len(&config->postdata) ?
    curlx_dyn_ptr(&config->postdata) : NULL;
  return jb_append_json_nullable_string(builder, value);
}

static int append_sensitive_string_field(
  struct JsonBuilder *builder,
  const char *value
)
{
  if(!value) {
    return jb_append(builder, "null");
  }

  if(jb_append(builder, "{") != 0 ||
     jb_append(builder, "\"value\":") != 0 ||
     jb_append_json_string(builder, value) != 0 ||
     jb_append(builder, ",\"sensitive\":true}") != 0) {
    return -1;
  }

  return 0;
}

static int append_operation_config(
  struct JsonBuilder *builder,
  const struct OperationConfig *config
)
{
  if(jb_append(builder, "\"config\":{") != 0 ||
     jb_append(builder, "\"headers\":") != 0 ||
     append_slist_array(builder, config->headers) != 0 ||
     jb_append(builder, ",\"proxyHeaders\":") != 0 ||
     append_slist_array(builder, config->proxyheaders) != 0 ||
     jb_append(builder, ",\"cookies\":") != 0 ||
     append_slist_array(builder, config->cookies) != 0 ||
     jb_append(builder, ",\"proxy\":") != 0 ||
     jb_append_json_nullable_string(builder, config->proxy) != 0 ||
     jb_append(builder, ",\"proto\":") != 0 ||
     jb_append_json_nullable_string(builder, config->proto_str) != 0 ||
     jb_append(builder, ",\"protoDefault\":") != 0 ||
     jb_append_json_nullable_string(builder, config->proto_default) != 0 ||
     jb_append(builder, ",\"httpVersion\":") != 0 ||
     (config->httpversion ?
       jb_appendf(builder, "%ld", config->httpversion) :
       jb_append(builder, "null")) != 0 ||
     jb_append(builder, ",\"customRequest\":") != 0 ||
     jb_append_json_nullable_string(builder, config->customrequest) != 0 ||
     jb_append(builder, ",\"uploadFile\":") != 0 ||
     jb_append_json_nullable_string(builder,
                                    config->url_list ? config->url_list->infile : NULL) != 0 ||
     jb_append(builder, ",\"postFields\":") != 0 ||
     jb_append_json_nullable_string(builder, config->postfields) != 0 ||
     jb_append(builder, ",\"postData\":") != 0 ||
     append_postdata(builder, config) != 0 ||
     jb_append(builder, ",\"userAgent\":") != 0 ||
     jb_append_json_nullable_string(builder, config->useragent) != 0 ||
     jb_append(builder, ",\"userPwd\":") != 0 ||
     append_sensitive_string_field(builder, config->userpwd) != 0 ||
     jb_append(builder, ",\"tls\":{},\"auth\":{},") != 0 ||
     jb_append(builder, "\"timeouts\":{") != 0 ||
     jb_appendf(builder,
                "\"connectTimeoutMs\":%ld,\"maxTimeMs\":%ld,"
                "\"expect100TimeoutMs\":%ld,\"happyEyeballsTimeoutMs\":%ld}",
                config->connecttimeout_ms,
                config->timeout_ms,
                config->expect100timeout_ms,
                config->happy_eyeballs_timeout_ms) != 0 ||
     jb_append(builder, ",\"retry\":{") != 0 ||
     jb_appendf(builder,
                "\"count\":%ld,\"delayMs\":%u,\"maxTimeMs\":%ld}",
                config->req_retry,
                config->retry_delay_ms,
                config->retry_maxtime_ms) != 0 ||
     jb_append(builder, ",\"output\":{") != 0 ||
     jb_appendf(builder,
                "\"remoteNameAll\":%s,\"outputDir\":",
                config->remote_name_all ? "true" : "false") != 0 ||
     jb_append_json_nullable_string(builder, config->output_dir) != 0 ||
     jb_append(builder, ",\"headerFile\":") != 0 ||
     jb_append_json_nullable_string(builder, config->headerfile) != 0 ||
     jb_append(builder, "}}") != 0) {
    return -1;
  }

  return 0;
}

static int serialize_operations(
  const struct GlobalConfig *global_config,
  bool wrap_object,
  char **out_json,
  size_t *out_len
)
{
  struct JsonBuilder builder;
  const struct OperationConfig *config;
  size_t index = 0;
  bool first = true;

  if(!global_config || !out_json || !out_len) {
    return -1;
  }

  memset(&builder, 0, sizeof(builder));

  if(wrap_object) {
    if(jb_append(&builder, "{\"operations\":") != 0) {
      free(builder.data);
      return -1;
    }
  }

  if(jb_append(&builder, "[") != 0) {
    free(builder.data);
    return -1;
  }

  for(config = global_config->first; config; config = config->next, ++index) {
    if(!first && jb_append(&builder, ",") != 0) {
      free(builder.data);
      return -1;
    }
    if(jb_appendf(&builder, "{\"index\":%zu,", index) != 0 ||
       jb_append(&builder, "\"urls\":") != 0 ||
       append_urls(&builder, config->url_list) != 0 ||
       jb_append(&builder, ",") != 0 ||
       append_operation_config(&builder, config) != 0 ||
       jb_append(&builder, "}") != 0) {
      free(builder.data);
      return -1;
    }
    first = false;
  }

  if(jb_append(&builder, "]") != 0 ||
     (wrap_object && jb_append(&builder, "}") != 0)) {
    free(builder.data);
    return -1;
  }

  *out_json = builder.data;
  *out_len = builder.length;
  return 0;
}

int curlparse_serialize_operations_json(
  const struct GlobalConfig *global_config,
  char **out_json,
  size_t *out_len
)
{
  return serialize_operations(global_config, true, out_json, out_len);
}

int curlparse_serialize_operations_array_json(
  const struct GlobalConfig *global_config,
  char **out_json,
  size_t *out_len
)
{
  return serialize_operations(global_config, false, out_json, out_len);
}
