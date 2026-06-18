#include "api/curlparse_json.h"

#include <ctype.h>
#include <stdlib.h>
#include <string.h>

static const char *skip_ws(const char *cursor, const char *end)
{
  while(cursor < end && isspace((unsigned char)*cursor)) {
    ++cursor;
  }
  return cursor;
}

static const char *find_key(
  const char *json,
  const char *end,
  const char *key
)
{
  size_t key_len = strlen(key);
  const char *cursor = json;
  const char *probe;

  while(cursor && cursor < end) {
    cursor = strstr(cursor, key);
    if(!cursor || cursor >= end) {
      return NULL;
    }

    if((size_t)(end - cursor) >= key_len) {
      probe = skip_ws(cursor + key_len, end);
      if(probe < end && *probe == ':') {
        return cursor + key_len;
      }
    }
    cursor += key_len;
  }

  return NULL;
}

static int append_char(
  char **buffer,
  size_t *length,
  size_t *capacity,
  char value
)
{
  char *grown;

  if(*length + 1 >= *capacity) {
    size_t new_capacity = *capacity ? (*capacity * 2) : 16;
    grown = realloc(*buffer, new_capacity);
    if(!grown) {
      return -1;
    }
    *buffer = grown;
    *capacity = new_capacity;
  }

  (*buffer)[(*length)++] = value;
  return 0;
}

static void free_string_array(char **items, size_t count)
{
  size_t i;

  if(!items) {
    return;
  }

  for(i = 0; i < count; ++i) {
    free(items[i]);
  }
  free(items);
}

static int parse_json_string(
  const char **cursorp,
  const char *end,
  char **out
)
{
  const char *cursor = *cursorp;
  char *buffer = NULL;
  size_t length = 0;
  size_t capacity = 0;

  if(cursor >= end || *cursor != '"') {
    return -1;
  }

  ++cursor;
  while(cursor < end) {
    char ch = *cursor++;
    if(ch == '"') {
      break;
    }

    if(ch == '\\') {
      if(cursor >= end) {
        free(buffer);
        return -1;
      }
      ch = *cursor++;
      switch(ch) {
      case '"':
      case '\\':
      case '/':
        break;
      case 'b':
        ch = '\b';
        break;
      case 'f':
        ch = '\f';
        break;
      case 'n':
        ch = '\n';
        break;
      case 'r':
        ch = '\r';
        break;
      case 't':
        ch = '\t';
        break;
      default:
        free(buffer);
        return -1;
      }
    }

    if(append_char(&buffer, &length, &capacity, ch) != 0) {
      free(buffer);
      return -1;
    }
  }

  if(cursor > end || cursor[-1] != '"') {
    free(buffer);
    return -1;
  }

  if(append_char(&buffer, &length, &capacity, '\0') != 0) {
    free(buffer);
    return -1;
  }

  *cursorp = cursor;
  *out = buffer;
  return 0;
}

static int parse_string_array_value(
  const char *json,
  const char *end,
  const char *key,
  bool allow_null,
  char ***out_items,
  size_t *out_count,
  bool *out_is_null
)
{
  const char *cursor = find_key(json, end, key);
  char **items = NULL;
  size_t count = 0;
  size_t capacity = 0;

  if(out_is_null) {
    *out_is_null = false;
  }

  if(!cursor) {
    return -1;
  }

  cursor = skip_ws(cursor, end);
  if(cursor >= end || *cursor != ':') {
    return -1;
  }
  cursor = skip_ws(cursor + 1, end);

  if(allow_null && (size_t)(end - cursor) >= 4U && strncmp(cursor, "null", 4) == 0) {
    if(out_is_null) {
      *out_is_null = true;
    }
    *out_items = NULL;
    *out_count = 0;
    return 0;
  }

  if(cursor >= end || *cursor != '[') {
    return -1;
  }
  cursor = skip_ws(cursor + 1, end);

  while(cursor < end && *cursor != ']') {
    char *value;
    char **grown;

    if(parse_json_string(&cursor, end, &value) != 0) {
      free_string_array(items, count);
      return -1;
    }

    if(count == capacity) {
      size_t new_capacity = capacity ? (capacity * 2U) : 4U;
      grown = realloc(items, new_capacity * sizeof(*items));
      if(!grown) {
        free(value);
        free_string_array(items, count);
        return -1;
      }
      items = grown;
      capacity = new_capacity;
    }

    items[count++] = value;
    cursor = skip_ws(cursor, end);
    if(cursor < end && *cursor == ',') {
      cursor = skip_ws(cursor + 1, end);
    }
  }

  if(cursor >= end || *cursor != ']') {
    free_string_array(items, count);
    return -1;
  }

  *out_items = items;
  *out_count = count;
  return 0;
}

static int parse_argv_array(
  const char *json,
  const char *end,
  struct CurlparseInput *out
)
{
  const char *cursor;
  char **argv = NULL;
  size_t argv_count = 0;
  size_t argv_capacity = 0;

  cursor = find_key(json, end, "\"argv\"");
  if(!cursor) {
    return -1;
  }

  cursor = skip_ws(cursor, end);
  if(cursor >= end || *cursor != ':') {
    return -1;
  }
  cursor = skip_ws(cursor + 1, end);
  if(cursor >= end || *cursor != '[') {
    return -1;
  }
  cursor = skip_ws(cursor + 1, end);

  while(cursor < end && *cursor != ']') {
    char *value;
    char **grown;

    if(parse_json_string(&cursor, end, &value) != 0) {
      goto fail;
    }

    if(argv_count == argv_capacity) {
      size_t new_capacity = argv_capacity ? (argv_capacity * 2) : 4;
      grown = realloc(argv, new_capacity * sizeof(*argv));
      if(!grown) {
        free(value);
        goto fail;
      }
      argv = grown;
      argv_capacity = new_capacity;
    }

    argv[argv_count++] = value;
    cursor = skip_ws(cursor, end);
    if(cursor < end && *cursor == ',') {
      cursor = skip_ws(cursor + 1, end);
      continue;
    }
  }

  if(cursor >= end || *cursor != ']' || argv_count == 0) {
    goto fail;
  }

  out->argv = (const char **)argv;
  out->argv_count = argv_count;
  return 0;

fail:
  if(argv) {
    size_t i;
    for(i = 0; i < argv_count; ++i) {
      free(argv[i]);
    }
  }
  free(argv);
  return -1;
}

static int parse_string_value_for_key(
  const char *json,
  const char *end,
  const char *key,
  char **out_value
)
{
  const char *cursor = find_key(json, end, key);

  if(!cursor) {
    return -1;
  }

  cursor = skip_ws(cursor, end);
  if(cursor >= end || *cursor != ':') {
    return -1;
  }

  cursor = skip_ws(cursor + 1, end);
  return parse_json_string(&cursor, end, out_value);
}

static int validate_input_mode(const char *json, const char *end)
{
  char *value;
  int rc;

  if(!find_key(json, end, "\"inputMode\"")) {
    return 0;
  }

  if(parse_string_value_for_key(json, end, "\"inputMode\"", &value) != 0) {
    return -1;
  }

  rc = (strcmp(value, "argv") == 0) ? 0 : -1;
  free(value);
  return rc;
}

static int parse_runtime_profile(
  const char *json,
  const char *end,
  struct CurlparseInput *out
)
{
  char **items = NULL;
  size_t count = 0;
  bool is_null = false;

  if(!find_key(json, end, "\"runtimeProfile\"")) {
    curlparse_profile_default(&out->runtime_profile);
    out->runtime_profile_defaulted = true;
    return 0;
  }

  curlparse_profile_default(&out->runtime_profile);
  out->runtime_profile_defaulted = false;

  if(parse_string_value_for_key(json, end, "\"curlVersion\"",
                                &out->owned_curl_version) == 0) {
    out->runtime_profile.curl_version = out->owned_curl_version;
  }

  if(parse_string_array_value(json, end, "\"protocols\"", false,
                              &items, &count, NULL) == 0) {
    out->owned_protocols = items;
    out->owned_protocol_count = count;
    out->runtime_profile.protocols = (const char *const *)items;
    out->runtime_profile.protocol_count = count;
    items = NULL;
    count = 0;
  }

  if(parse_string_array_value(json, end, "\"features\"", false,
                              &items, &count, NULL) == 0) {
    out->owned_features = items;
    out->owned_feature_count = count;
    out->runtime_profile.features = (const char *const *)items;
    out->runtime_profile.feature_count = count;
    items = NULL;
    count = 0;
  }

  if(parse_string_array_value(json, end, "\"availableOptions\"", true,
                              &items, &count, &is_null) == 0) {
    out->runtime_profile.available_options_is_set = !is_null;
    out->owned_available_options = items;
    out->owned_available_option_count = count;
    out->runtime_profile.available_options = (const char *const *)items;
    out->runtime_profile.available_option_count = count;
    items = NULL;
    count = 0;
  }

  if(parse_string_array_value(json, end, "\"disabledOptions\"", false,
                              &items, &count, NULL) == 0) {
    out->owned_disabled_options = items;
    out->owned_disabled_option_count = count;
    out->runtime_profile.disabled_options = (const char *const *)items;
    out->runtime_profile.disabled_option_count = count;
    items = NULL;
    count = 0;
  }

  if(parse_string_array_value(json, end, "\"defines\"", false,
                              &items, &count, NULL) == 0) {
    out->owned_defines = items;
    out->owned_define_count = count;
    out->runtime_profile.defines = (const char *const *)items;
    out->runtime_profile.define_count = count;
  }

  return 0;
}

int curlparse_json_parse_input(
  const char *json,
  size_t json_len,
  struct CurlparseInput *out
)
{
  const char *end;
  char *input_mode = NULL;

  if(!json || !out || json_len == 0) {
    return -1;
  }

  memset(out, 0, sizeof(*out));
  end = json + json_len;

  if(validate_input_mode(json, end) != 0) {
    return -1;
  }

  if(find_key(json, end, "\"inputMode\"") &&
     parse_string_value_for_key(json, end, "\"inputMode\"", &input_mode) != 0) {
    return -1;
  }

  if(parse_argv_array(json, end, out) != 0) {
    free(input_mode);
    curlparse_json_free_input(out);
    return -1;
  }

  if(parse_runtime_profile(json, end, out) != 0) {
    free(input_mode);
    curlparse_json_free_input(out);
    return -1;
  }

  out->parse_mode = "strict";
  if(parse_string_value_for_key(json, end, "\"parseMode\"",
                                &out->owned_parse_mode) == 0) {
    out->parse_mode = out->owned_parse_mode;
  }
  free(input_mode);
  return 0;
}

void curlparse_json_free_input(struct CurlparseInput *input)
{
  size_t i;

  if(!input) {
    return;
  }

  if(input->argv) {
    for(i = 0; i < input->argv_count; ++i) {
      free((void *)input->argv[i]);
    }
  }

  free((void *)input->argv);
  free_string_array(input->owned_protocols, input->owned_protocol_count);
  free_string_array(input->owned_features, input->owned_feature_count);
  free_string_array(input->owned_available_options,
                    input->owned_available_option_count);
  free_string_array(input->owned_disabled_options,
                    input->owned_disabled_option_count);
  free_string_array(input->owned_defines, input->owned_define_count);
  free(input->owned_curl_version);
  free(input->owned_parse_mode);
  memset(input, 0, sizeof(*input));
}
