#include "api/curlparse_json.h"

#include <ctype.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CURLPARSE_JSON_INPUT_LIMIT (1024U * 1024U)
#define CURLPARSE_JSON_DEPTH_LIMIT 32U
#define CURLPARSE_JSON_ARRAY_LIMIT 4096U
#define CURLPARSE_JSON_OBJECT_LIMIT 512U

enum CurlparseJsonType {
  CURLPARSE_JSON_NULL,
  CURLPARSE_JSON_BOOL,
  CURLPARSE_JSON_STRING,
  CURLPARSE_JSON_NUMBER,
  CURLPARSE_JSON_ARRAY,
  CURLPARSE_JSON_OBJECT
};

struct CurlparseJsonValue;

struct CurlparseJsonMember {
  char *key;
  struct CurlparseJsonValue *value;
};

struct CurlparseJsonValue {
  enum CurlparseJsonType type;
  char *text;
  bool boolean;
  struct CurlparseJsonValue **items;
  size_t item_count;
  struct CurlparseJsonMember *members;
  size_t member_count;
};

struct CurlparseJsonParser {
  const char *cursor;
  const char *end;
  struct CurlparseJsonError *error;
};

static void set_error(
  struct CurlparseJsonError *error,
  const char *path,
  const char *message,
  const char *expected,
  const char *actual
)
{
  if(!error) {
    return;
  }

  memset(error, 0, sizeof(*error));
  error->code = "E_INPUT_SCHEMA_INVALID";
  error->severity = "fatal";
  error->category = "input";
  snprintf(error->message, sizeof(error->message), "%s",
           message ? message : "Invalid input JSON");
  snprintf(error->path, sizeof(error->path), "%s", path ? path : "$");
  snprintf(error->expected, sizeof(error->expected), "%s",
           expected ? expected : "valid parse input JSON");
  snprintf(error->actual, sizeof(error->actual), "%s", actual ? actual : "");
}

static void set_too_large_error(struct CurlparseJsonError *error, size_t length)
{
  char actual[64];
  snprintf(actual, sizeof(actual), "%zu bytes", length);
  set_error(error, "$", "Input JSON exceeds limit", "<= 1048576 bytes", actual);
  if(error) {
    error->code = "E_INPUT_TOO_LARGE";
  }
}

static char *curlparse_strdup(const char *input)
{
  size_t size;
  char *copy;

  if(!input) {
    return NULL;
  }

  size = strlen(input) + 1U;
  copy = malloc(size);
  if(copy) {
    memcpy(copy, input, size);
  }
  return copy;
}

static char *curlparse_strndup(const char *input, size_t length)
{
  char *copy = malloc(length + 1U);
  if(!copy) {
    return NULL;
  }
  memcpy(copy, input, length);
  copy[length] = '\0';
  return copy;
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

static void json_value_free(struct CurlparseJsonValue *value)
{
  size_t i;

  if(!value) {
    return;
  }

  free(value->text);
  for(i = 0; i < value->item_count; ++i) {
    json_value_free(value->items[i]);
  }
  free(value->items);
  for(i = 0; i < value->member_count; ++i) {
    free(value->members[i].key);
    json_value_free(value->members[i].value);
  }
  free(value->members);
  free(value);
}

static struct CurlparseJsonValue *json_value_new(enum CurlparseJsonType type)
{
  struct CurlparseJsonValue *value = calloc(1U, sizeof(*value));
  if(value) {
    value->type = type;
  }
  return value;
}

static void skip_ws(struct CurlparseJsonParser *parser)
{
  while(parser->cursor < parser->end &&
        isspace((unsigned char)*parser->cursor)) {
    ++parser->cursor;
  }
}

static int append_char(
  char **buffer,
  size_t *length,
  size_t *capacity,
  char value
)
{
  char *grown;

  if(*length + 1U >= *capacity) {
    size_t new_capacity = *capacity ? (*capacity * 2U) : 16U;
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

static unsigned int hex_value(char ch)
{
  if(ch >= '0' && ch <= '9') {
    return (unsigned int)(ch - '0');
  }
  if(ch >= 'a' && ch <= 'f') {
    return (unsigned int)(ch - 'a' + 10);
  }
  if(ch >= 'A' && ch <= 'F') {
    return (unsigned int)(ch - 'A' + 10);
  }
  return 16U;
}

static int append_utf8(
  char **buffer,
  size_t *length,
  size_t *capacity,
  uint32_t codepoint
)
{
  if(codepoint <= 0x7FU) {
    return append_char(buffer, length, capacity, (char)codepoint);
  }
  if(codepoint <= 0x7FFU) {
    return append_char(buffer, length, capacity,
                       (char)(0xC0U | (codepoint >> 6))) != 0 ||
      append_char(buffer, length, capacity,
                  (char)(0x80U | (codepoint & 0x3FU))) != 0 ? -1 : 0;
  }
  if(codepoint <= 0xFFFFU) {
    return append_char(buffer, length, capacity,
                       (char)(0xE0U | (codepoint >> 12))) != 0 ||
      append_char(buffer, length, capacity,
                  (char)(0x80U | ((codepoint >> 6) & 0x3FU))) != 0 ||
      append_char(buffer, length, capacity,
                  (char)(0x80U | (codepoint & 0x3FU))) != 0 ? -1 : 0;
  }
  if(codepoint <= 0x10FFFFU) {
    return append_char(buffer, length, capacity,
                       (char)(0xF0U | (codepoint >> 18))) != 0 ||
      append_char(buffer, length, capacity,
                  (char)(0x80U | ((codepoint >> 12) & 0x3FU))) != 0 ||
      append_char(buffer, length, capacity,
                  (char)(0x80U | ((codepoint >> 6) & 0x3FU))) != 0 ||
      append_char(buffer, length, capacity,
                  (char)(0x80U | (codepoint & 0x3FU))) != 0 ? -1 : 0;
  }
  return -1;
}

static int parse_hex4(struct CurlparseJsonParser *parser, uint32_t *out)
{
  uint32_t value = 0;
  size_t i;

  if((size_t)(parser->end - parser->cursor) < 4U) {
    return -1;
  }

  for(i = 0; i < 4U; ++i) {
    unsigned int digit = hex_value(parser->cursor[i]);
    if(digit > 15U) {
      return -1;
    }
    value = (value << 4) | digit;
  }
  parser->cursor += 4;
  *out = value;
  return 0;
}

static int parse_json_string(
  struct CurlparseJsonParser *parser,
  const char *path,
  char **out
)
{
  char *buffer = NULL;
  size_t length = 0;
  size_t capacity = 0;

  if(parser->cursor >= parser->end || *parser->cursor != '"') {
    set_error(parser->error, path, "Expected JSON string", "string", "other");
    return -1;
  }

  ++parser->cursor;
  while(parser->cursor < parser->end) {
    unsigned char ch = (unsigned char)*parser->cursor++;

    if(ch == '"') {
      if(append_char(&buffer, &length, &capacity, '\0') != 0) {
        free(buffer);
        return -1;
      }
      *out = buffer;
      return 0;
    }

    if(ch < 0x20U) {
      set_error(parser->error, path, "Unescaped control character",
                "escaped string character", "control character");
      free(buffer);
      return -1;
    }

    if(ch == '\\') {
      if(parser->cursor >= parser->end) {
        set_error(parser->error, path, "Unterminated string escape",
                  "escape sequence", "end of input");
        free(buffer);
        return -1;
      }
      ch = (unsigned char)*parser->cursor++;
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
      case 'u': {
        uint32_t codepoint;
        if(parse_hex4(parser, &codepoint) != 0) {
          set_error(parser->error, path, "Invalid unicode escape",
                    "\\uXXXX", "invalid escape");
          free(buffer);
          return -1;
        }
        if(codepoint >= 0xD800U && codepoint <= 0xDBFFU) {
          uint32_t low;
          if((size_t)(parser->end - parser->cursor) < 6U ||
             parser->cursor[0] != '\\' || parser->cursor[1] != 'u') {
            set_error(parser->error, path, "Invalid unicode surrogate pair",
                      "low surrogate", "missing low surrogate");
            free(buffer);
            return -1;
          }
          parser->cursor += 2;
          if(parse_hex4(parser, &low) != 0 ||
             low < 0xDC00U || low > 0xDFFFU) {
            set_error(parser->error, path, "Invalid unicode surrogate pair",
                      "low surrogate", "invalid low surrogate");
            free(buffer);
            return -1;
          }
          codepoint = 0x10000U + (((codepoint - 0xD800U) << 10) |
                                  (low - 0xDC00U));
        }
        if(append_utf8(&buffer, &length, &capacity, codepoint) != 0) {
          free(buffer);
          return -1;
        }
        continue;
      }
      default:
        set_error(parser->error, path, "Invalid string escape",
                  "valid JSON escape", "invalid escape");
        free(buffer);
        return -1;
      }
    }

    if(append_char(&buffer, &length, &capacity, (char)ch) != 0) {
      free(buffer);
      return -1;
    }
  }

  set_error(parser->error, path, "Unterminated JSON string",
            "closing quote", "end of input");
  free(buffer);
  return -1;
}

static void child_path(
  char *buffer,
  size_t buffer_size,
  const char *parent,
  const char *key
)
{
  bool simple = key && *key &&
    ((key[0] >= 'A' && key[0] <= 'Z') ||
     (key[0] >= 'a' && key[0] <= 'z') ||
     key[0] == '_');
  size_t i;

  if(simple) {
    for(i = 1; key[i]; ++i) {
      if(!((key[i] >= 'A' && key[i] <= 'Z') ||
           (key[i] >= 'a' && key[i] <= 'z') ||
           (key[i] >= '0' && key[i] <= '9') ||
           key[i] == '_' || key[i] == '-')) {
        simple = false;
        break;
      }
    }
  }

  if(simple) {
    snprintf(buffer, buffer_size, "%s.%s", parent, key);
  }
  else {
    snprintf(buffer, buffer_size, "%s[\"%s\"]", parent, key ? key : "");
  }
}

static void index_path(
  char *buffer,
  size_t buffer_size,
  const char *parent,
  size_t index
)
{
  snprintf(buffer, buffer_size, "%s[%zu]", parent, index);
}

static struct CurlparseJsonValue *parse_value(
  struct CurlparseJsonParser *parser,
  const char *path,
  unsigned int depth
);

static int object_has_key(
  const struct CurlparseJsonValue *object,
  const char *key
)
{
  size_t i;

  for(i = 0; i < object->member_count; ++i) {
    if(strcmp(object->members[i].key, key) == 0) {
      return 1;
    }
  }
  return 0;
}

static struct CurlparseJsonValue *parse_object(
  struct CurlparseJsonParser *parser,
  const char *path,
  unsigned int depth
)
{
  struct CurlparseJsonValue *object = json_value_new(CURLPARSE_JSON_OBJECT);

  if(!object) {
    return NULL;
  }

  ++parser->cursor;
  skip_ws(parser);
  if(parser->cursor < parser->end && *parser->cursor == '}') {
    ++parser->cursor;
    return object;
  }

  while(parser->cursor < parser->end) {
    char *key = NULL;
    char next_path[128];
    struct CurlparseJsonValue *value;
    struct CurlparseJsonMember *grown;

    if(object->member_count >= CURLPARSE_JSON_OBJECT_LIMIT) {
      set_error(parser->error, path, "Object member limit exceeded",
                "<= 512 members", "too many members");
      json_value_free(object);
      return NULL;
    }

    if(parse_json_string(parser, path, &key) != 0) {
      json_value_free(object);
      return NULL;
    }
    child_path(next_path, sizeof(next_path), path, key);
    if(object_has_key(object, key)) {
      set_error(parser->error, next_path, "Duplicate object key",
                "unique object key", key);
      free(key);
      json_value_free(object);
      return NULL;
    }

    skip_ws(parser);
    if(parser->cursor >= parser->end || *parser->cursor != ':') {
      set_error(parser->error, next_path, "Expected object separator",
                ":", "other");
      free(key);
      json_value_free(object);
      return NULL;
    }
    ++parser->cursor;

    value = parse_value(parser, next_path, depth + 1U);
    if(!value) {
      free(key);
      json_value_free(object);
      return NULL;
    }

    grown = realloc(object->members,
                    (object->member_count + 1U) * sizeof(*object->members));
    if(!grown) {
      free(key);
      json_value_free(value);
      json_value_free(object);
      return NULL;
    }
    object->members = grown;
    object->members[object->member_count].key = key;
    object->members[object->member_count].value = value;
    ++object->member_count;

    skip_ws(parser);
    if(parser->cursor < parser->end && *parser->cursor == ',') {
      ++parser->cursor;
      skip_ws(parser);
      continue;
    }
    if(parser->cursor < parser->end && *parser->cursor == '}') {
      ++parser->cursor;
      return object;
    }
    set_error(parser->error, path, "Expected object terminator",
              ", or }", "other");
    json_value_free(object);
    return NULL;
  }

  set_error(parser->error, path, "Unterminated object", "}", "end of input");
  json_value_free(object);
  return NULL;
}

static struct CurlparseJsonValue *parse_array(
  struct CurlparseJsonParser *parser,
  const char *path,
  unsigned int depth
)
{
  struct CurlparseJsonValue *array = json_value_new(CURLPARSE_JSON_ARRAY);

  if(!array) {
    return NULL;
  }

  ++parser->cursor;
  skip_ws(parser);
  if(parser->cursor < parser->end && *parser->cursor == ']') {
    ++parser->cursor;
    return array;
  }

  while(parser->cursor < parser->end) {
    char next_path[128];
    struct CurlparseJsonValue *item;
    struct CurlparseJsonValue **grown;

    if(array->item_count >= CURLPARSE_JSON_ARRAY_LIMIT) {
      set_error(parser->error, path, "Array item limit exceeded",
                "<= 4096 items", "too many items");
      json_value_free(array);
      return NULL;
    }

    index_path(next_path, sizeof(next_path), path, array->item_count);
    item = parse_value(parser, next_path, depth + 1U);
    if(!item) {
      json_value_free(array);
      return NULL;
    }

    grown = realloc(array->items,
                    (array->item_count + 1U) * sizeof(*array->items));
    if(!grown) {
      json_value_free(item);
      json_value_free(array);
      return NULL;
    }
    array->items = grown;
    array->items[array->item_count++] = item;

    skip_ws(parser);
    if(parser->cursor < parser->end && *parser->cursor == ',') {
      ++parser->cursor;
      skip_ws(parser);
      continue;
    }
    if(parser->cursor < parser->end && *parser->cursor == ']') {
      ++parser->cursor;
      return array;
    }
    set_error(parser->error, path, "Expected array terminator",
              ", or ]", "other");
    json_value_free(array);
    return NULL;
  }

  set_error(parser->error, path, "Unterminated array", "]", "end of input");
  json_value_free(array);
  return NULL;
}

static struct CurlparseJsonValue *parse_number(
  struct CurlparseJsonParser *parser,
  const char *path
)
{
  const char *start = parser->cursor;
  struct CurlparseJsonValue *value;

  if(parser->cursor < parser->end && *parser->cursor == '-') {
    ++parser->cursor;
  }

  if(parser->cursor >= parser->end || !isdigit((unsigned char)*parser->cursor)) {
    set_error(parser->error, path, "Invalid number", "number", "other");
    return NULL;
  }

  if(*parser->cursor == '0') {
    ++parser->cursor;
  }
  else {
    while(parser->cursor < parser->end &&
          isdigit((unsigned char)*parser->cursor)) {
      ++parser->cursor;
    }
  }

  if(parser->cursor < parser->end && *parser->cursor == '.') {
    ++parser->cursor;
    if(parser->cursor >= parser->end ||
       !isdigit((unsigned char)*parser->cursor)) {
      set_error(parser->error, path, "Invalid number fraction",
                "digits", "other");
      return NULL;
    }
    while(parser->cursor < parser->end &&
          isdigit((unsigned char)*parser->cursor)) {
      ++parser->cursor;
    }
  }

  if(parser->cursor < parser->end &&
     (*parser->cursor == 'e' || *parser->cursor == 'E')) {
    ++parser->cursor;
    if(parser->cursor < parser->end &&
       (*parser->cursor == '+' || *parser->cursor == '-')) {
      ++parser->cursor;
    }
    if(parser->cursor >= parser->end ||
       !isdigit((unsigned char)*parser->cursor)) {
      set_error(parser->error, path, "Invalid number exponent",
                "digits", "other");
      return NULL;
    }
    while(parser->cursor < parser->end &&
          isdigit((unsigned char)*parser->cursor)) {
      ++parser->cursor;
    }
  }

  value = json_value_new(CURLPARSE_JSON_NUMBER);
  if(!value) {
    return NULL;
  }
  value->text = curlparse_strndup(start, (size_t)(parser->cursor - start));
  if(!value->text) {
    json_value_free(value);
    return NULL;
  }
  return value;
}

static struct CurlparseJsonValue *parse_literal(
  struct CurlparseJsonParser *parser,
  const char *path,
  const char *literal,
  enum CurlparseJsonType type,
  bool boolean
)
{
  struct CurlparseJsonValue *value;
  size_t length = strlen(literal);

  if((size_t)(parser->end - parser->cursor) < length ||
     strncmp(parser->cursor, literal, length) != 0) {
    set_error(parser->error, path, "Invalid JSON literal",
              literal, "other");
    return NULL;
  }

  parser->cursor += length;
  value = json_value_new(type);
  if(value) {
    value->boolean = boolean;
  }
  return value;
}

static struct CurlparseJsonValue *parse_value(
  struct CurlparseJsonParser *parser,
  const char *path,
  unsigned int depth
)
{
  if(depth > CURLPARSE_JSON_DEPTH_LIMIT) {
    set_error(parser->error, path, "JSON depth limit exceeded",
              "<= 32 levels", "too deep");
    return NULL;
  }

  skip_ws(parser);
  if(parser->cursor >= parser->end) {
    set_error(parser->error, path, "Expected JSON value",
              "value", "end of input");
    return NULL;
  }

  switch(*parser->cursor) {
  case '{':
    return parse_object(parser, path, depth);
  case '[':
    return parse_array(parser, path, depth);
  case '"': {
    struct CurlparseJsonValue *value = json_value_new(CURLPARSE_JSON_STRING);
    if(!value) {
      return NULL;
    }
    if(parse_json_string(parser, path, &value->text) != 0) {
      json_value_free(value);
      return NULL;
    }
    return value;
  }
  case 't':
    return parse_literal(parser, path, "true", CURLPARSE_JSON_BOOL, true);
  case 'f':
    return parse_literal(parser, path, "false", CURLPARSE_JSON_BOOL, false);
  case 'n':
    return parse_literal(parser, path, "null", CURLPARSE_JSON_NULL, false);
  default:
    if(*parser->cursor == '-' || isdigit((unsigned char)*parser->cursor)) {
      return parse_number(parser, path);
    }
    set_error(parser->error, path, "Invalid JSON value",
              "object, array, string, number, boolean, or null", "other");
    return NULL;
  }
}

static struct CurlparseJsonValue *parse_document(
  const char *json,
  size_t json_len,
  struct CurlparseJsonError *error
)
{
  struct CurlparseJsonParser parser;
  struct CurlparseJsonValue *root;

  if(!json || json_len == 0U) {
    set_error(error, "$", "Input JSON is empty", "object", "empty input");
    return NULL;
  }
  if(json_len > CURLPARSE_JSON_INPUT_LIMIT) {
    set_too_large_error(error, json_len);
    return NULL;
  }

  parser.cursor = json;
  parser.end = json + json_len;
  parser.error = error;
  root = parse_value(&parser, "$", 0U);
  if(!root) {
    return NULL;
  }

  skip_ws(&parser);
  if(parser.cursor != parser.end) {
    set_error(error, "$", "Trailing data after JSON document",
              "end of input", "trailing data");
    json_value_free(root);
    return NULL;
  }

  return root;
}

static const struct CurlparseJsonValue *object_get(
  const struct CurlparseJsonValue *object,
  const char *key
)
{
  size_t i;

  if(!object || object->type != CURLPARSE_JSON_OBJECT) {
    return NULL;
  }

  for(i = 0; i < object->member_count; ++i) {
    if(strcmp(object->members[i].key, key) == 0) {
      return object->members[i].value;
    }
  }
  return NULL;
}

static const char *json_type_name(const struct CurlparseJsonValue *value)
{
  if(!value) {
    return "missing";
  }
  switch(value->type) {
  case CURLPARSE_JSON_NULL:
    return "null";
  case CURLPARSE_JSON_BOOL:
    return "boolean";
  case CURLPARSE_JSON_STRING:
    return "string";
  case CURLPARSE_JSON_NUMBER:
    return "number";
  case CURLPARSE_JSON_ARRAY:
    return "array";
  case CURLPARSE_JSON_OBJECT:
    return "object";
  }
  return "unknown";
}

static int expect_string(
  const struct CurlparseJsonValue *object,
  const char *key,
  const char *path,
  bool required,
  const char **out,
  struct CurlparseJsonError *error
)
{
  const struct CurlparseJsonValue *value = object_get(object, key);
  char next_path[128];

  *out = NULL;
  child_path(next_path, sizeof(next_path), path, key);
  if(!value) {
    if(required) {
      set_error(error, next_path, "Missing required field", "string", "missing");
      return -1;
    }
    return 0;
  }

  if(value->type != CURLPARSE_JSON_STRING) {
    set_error(error, next_path, "Invalid field type", "string",
              json_type_name(value));
    return -1;
  }
  *out = value->text;
  return 0;
}

static int expect_nullable_string(
  const struct CurlparseJsonValue *object,
  const char *key,
  const char *path,
  bool required,
  const char **out,
  bool *out_is_null,
  struct CurlparseJsonError *error
)
{
  const struct CurlparseJsonValue *value = object_get(object, key);
  char next_path[128];

  *out = NULL;
  if(out_is_null) {
    *out_is_null = false;
  }
  child_path(next_path, sizeof(next_path), path, key);
  if(!value) {
    if(required) {
      set_error(error, next_path, "Missing required field", "string", "missing");
      return -1;
    }
    return 0;
  }

  if(value->type == CURLPARSE_JSON_NULL) {
    if(out_is_null) {
      *out_is_null = true;
    }
    return 0;
  }
  if(value->type != CURLPARSE_JSON_STRING) {
    set_error(error, next_path, "Invalid field type", "string or null",
              json_type_name(value));
    return -1;
  }
  *out = value->text;
  return 0;
}

static int expect_bool(
  const struct CurlparseJsonValue *object,
  const char *key,
  const char *path,
  bool required,
  bool *out,
  bool *seen,
  struct CurlparseJsonError *error
)
{
  const struct CurlparseJsonValue *value = object_get(object, key);
  char next_path[128];

  if(seen) {
    *seen = false;
  }
  child_path(next_path, sizeof(next_path), path, key);
  if(!value) {
    if(required) {
      set_error(error, next_path, "Missing required field",
                "boolean", "missing");
      return -1;
    }
    return 0;
  }

  if(value->type != CURLPARSE_JSON_BOOL) {
    set_error(error, next_path, "Invalid field type", "boolean",
              json_type_name(value));
    return -1;
  }
  *out = value->boolean;
  if(seen) {
    *seen = true;
  }
  return 0;
}

static int expect_long(
  const struct CurlparseJsonValue *object,
  const char *key,
  const char *path,
  bool required,
  long *out,
  bool *seen,
  struct CurlparseJsonError *error
)
{
  const struct CurlparseJsonValue *value = object_get(object, key);
  char next_path[128];
  char *endptr = NULL;
  long parsed;

  if(seen) {
    *seen = false;
  }
  child_path(next_path, sizeof(next_path), path, key);
  if(!value) {
    if(required) {
      set_error(error, next_path, "Missing required field", "integer", "missing");
      return -1;
    }
    return 0;
  }

  if(value->type == CURLPARSE_JSON_NULL) {
    return 0;
  }
  if(value->type != CURLPARSE_JSON_NUMBER || !value->text ||
     strchr(value->text, '.') || strchr(value->text, 'e') ||
     strchr(value->text, 'E')) {
    set_error(error, next_path, "Invalid field type", "integer or null",
              json_type_name(value));
    return -1;
  }

  parsed = strtol(value->text, &endptr, 10);
  if(!endptr || *endptr != '\0') {
    set_error(error, next_path, "Invalid integer", "integer", value->text);
    return -1;
  }
  *out = parsed;
  if(seen) {
    *seen = true;
  }
  return 0;
}

static int copy_string_array(
  const struct CurlparseJsonValue *object,
  const char *key,
  const char *path,
  bool required,
  bool allow_null,
  char ***out_items,
  size_t *out_count,
  bool *out_is_null,
  struct CurlparseJsonError *error
)
{
  const struct CurlparseJsonValue *array = object_get(object, key);
  char next_path[128];
  char **items = NULL;
  size_t i;

  *out_items = NULL;
  *out_count = 0;
  if(out_is_null) {
    *out_is_null = false;
  }
  child_path(next_path, sizeof(next_path), path, key);

  if(!array) {
    if(required) {
      set_error(error, next_path, "Missing required field",
                "array of strings", "missing");
      return -1;
    }
    return 0;
  }

  if(allow_null && array->type == CURLPARSE_JSON_NULL) {
    if(out_is_null) {
      *out_is_null = true;
    }
    return 0;
  }

  if(array->type != CURLPARSE_JSON_ARRAY) {
    set_error(error, next_path, "Invalid field type", "array",
              json_type_name(array));
    return -1;
  }

  items = calloc(array->item_count ? array->item_count : 1U, sizeof(*items));
  if(!items) {
    return -1;
  }

  for(i = 0; i < array->item_count; ++i) {
    char item_path[128];
    const struct CurlparseJsonValue *item = array->items[i];
    index_path(item_path, sizeof(item_path), next_path, i);
    if(item->type != CURLPARSE_JSON_STRING) {
      set_error(error, item_path, "Invalid array item type",
                "string", json_type_name(item));
      free_string_array(items, i);
      return -1;
    }
    items[i] = curlparse_strdup(item->text);
    if(!items[i]) {
      free_string_array(items, i);
      return -1;
    }
  }

  *out_items = items;
  *out_count = array->item_count;
  return 0;
}

static int reject_removed_host_fields(
  const struct CurlparseJsonValue *root,
  struct CurlparseJsonError *error
)
{
  if(object_get(root, "options")) {
    set_error(error, "$.options", "Removed field",
              "removed parser options are not accepted in v1",
              "options");
    return -1;
  }

  if(object_get(root, "policy")) {
    set_error(error, "$.policy", "Removed field",
              "removed parser options are not accepted in v1",
              "policy");
    return -1;
  }

  return 0;
}

static int set_owned_profile_string(
  char **owned,
  const char **target,
  const char *value
)
{
  char *copy;

  if(!value) {
    *target = NULL;
    return 0;
  }

  copy = curlparse_strdup(value);
  if(!copy) {
    return -1;
  }

  free(*owned);
  *owned = copy;
  *target = copy;
  return 0;
}

static int parse_runtime_profile(
  const struct CurlparseJsonValue *root,
  struct CurlparseInput *out,
  struct CurlparseJsonError *error
)
{
  const struct CurlparseJsonValue *profile = object_get(root, "runtimeProfile");
  const struct CurlparseJsonValue *compile;
  const struct CurlparseJsonValue *option_catalog;
  const struct CurlparseJsonValue *defaults;
  const char *curl_version = NULL;
  const char *text = NULL;
  char **items = NULL;
  size_t count = 0;
  bool is_null = false;
  bool seen = false;
  bool bool_value = false;
  long long_value = 0;

  if(!profile) {
    curlparse_profile_default(&out->runtime_profile);
    out->runtime_profile_defaulted = true;
    return 0;
  }

  if(profile->type != CURLPARSE_JSON_OBJECT) {
    set_error(error, "$.runtimeProfile", "Invalid field type",
              "object", json_type_name(profile));
    return -1;
  }

  curlparse_profile_default(&out->runtime_profile);
  out->runtime_profile_defaulted = false;

  if(expect_string(profile, "curlVersion", "$.runtimeProfile", false,
                   &curl_version, error) != 0) {
    return -1;
  }
  if(curl_version) {
    out->owned_curl_version = curlparse_strdup(curl_version);
    if(!out->owned_curl_version) {
      return -1;
    }
    out->runtime_profile.curl_version = out->owned_curl_version;
  }

  if(copy_string_array(profile, "protocols", "$.runtimeProfile", false, false,
                       &items, &count, NULL, error) != 0) {
    return -1;
  }
  if(items) {
    out->owned_protocols = items;
    out->owned_protocol_count = count;
    out->runtime_profile.protocols = (const char *const *)items;
    out->runtime_profile.protocol_count = count;
    items = NULL;
    count = 0;
  }

  if(copy_string_array(profile, "features", "$.runtimeProfile", false, false,
                       &items, &count, NULL, error) != 0) {
    return -1;
  }
  if(items) {
    out->owned_features = items;
    out->owned_feature_count = count;
    out->runtime_profile.features = (const char *const *)items;
    out->runtime_profile.feature_count = count;
    items = NULL;
    count = 0;
  }

  compile = object_get(profile, "compile");
  if(compile) {
    if(compile->type != CURLPARSE_JSON_OBJECT) {
      set_error(error, "$.runtimeProfile.compile", "Invalid field type",
                "object", json_type_name(compile));
      return -1;
    }

    if(copy_string_array(compile, "availableOptions",
                         "$.runtimeProfile.compile", false, true,
                         &items, &count, &is_null, error) != 0) {
      return -1;
    }
    if(items || is_null) {
      out->runtime_profile.available_options_is_set = !is_null;
      out->owned_available_options = items;
      out->owned_available_option_count = count;
      out->runtime_profile.available_options = (const char *const *)items;
      out->runtime_profile.available_option_count = count;
      items = NULL;
      count = 0;
    }

    if(copy_string_array(compile, "disabledOptions",
                         "$.runtimeProfile.compile", false, false,
                         &items, &count, NULL, error) != 0) {
      return -1;
    }
    if(items) {
      out->owned_disabled_options = items;
      out->owned_disabled_option_count = count;
      out->runtime_profile.disabled_options = (const char *const *)items;
      out->runtime_profile.disabled_option_count = count;
      items = NULL;
      count = 0;
    }

    if(copy_string_array(compile, "defines",
                         "$.runtimeProfile.compile", false, false,
                         &items, &count, NULL, error) != 0) {
      return -1;
    }
    if(items) {
      out->owned_defines = items;
      out->owned_define_count = count;
      out->runtime_profile.defines = (const char *const *)items;
      out->runtime_profile.define_count = count;
    }
  }

  option_catalog = object_get(profile, "optionCatalog");
  if(option_catalog) {
    if(option_catalog->type != CURLPARSE_JSON_OBJECT) {
      set_error(error, "$.runtimeProfile.optionCatalog", "Invalid field type",
                "object", json_type_name(option_catalog));
      return -1;
    }
    if(expect_string(option_catalog, "curlVersion",
                     "$.runtimeProfile.optionCatalog", false,
                     &text, error) != 0) {
      return -1;
    }
    if(text &&
       set_owned_profile_string(&out->owned_option_catalog_curl_version,
                                &out->runtime_profile.option_catalog_curl_version,
                                text) != 0) {
      return -1;
    }
    if(expect_string(option_catalog, "source",
                     "$.runtimeProfile.optionCatalog", false,
                     &text, error) != 0) {
      return -1;
    }
    if(text &&
       set_owned_profile_string(&out->owned_option_catalog_source,
                                &out->runtime_profile.option_catalog_source,
                                text) != 0) {
      return -1;
    }
    if(expect_string(option_catalog, "sha256",
                     "$.runtimeProfile.optionCatalog", false,
                     &text, error) != 0) {
      return -1;
    }
    if(text &&
       set_owned_profile_string(&out->owned_option_catalog_sha256,
                                &out->runtime_profile.option_catalog_sha256,
                                text) != 0) {
      return -1;
    }
  }

  if(expect_nullable_string(profile, "sslBackend", "$.runtimeProfile",
                            false, &text, NULL, error) != 0) {
    return -1;
  }
  if(text && set_owned_profile_string(&out->owned_ssl_backend,
                                      &out->runtime_profile.ssl_backend,
                                      text) != 0) {
    return -1;
  }
  if(expect_nullable_string(profile, "http3Backend", "$.runtimeProfile",
                            false, &text, NULL, error) != 0) {
    return -1;
  }
  if(text && set_owned_profile_string(&out->owned_http3_backend,
                                      &out->runtime_profile.http3_backend,
                                      text) != 0) {
    return -1;
  }
  if(expect_nullable_string(profile, "resolverBackend", "$.runtimeProfile",
                            false, &text, NULL, error) != 0) {
    return -1;
  }
  if(text && set_owned_profile_string(&out->owned_resolver_backend,
                                      &out->runtime_profile.resolver_backend,
                                      text) != 0) {
    return -1;
  }

  defaults = object_get(profile, "defaults");
  if(defaults) {
    if(defaults->type != CURLPARSE_JSON_OBJECT) {
      set_error(error, "$.runtimeProfile.defaults", "Invalid field type",
                "object", json_type_name(defaults));
      return -1;
    }
    if(expect_nullable_string(defaults, "userAgent",
                              "$.runtimeProfile.defaults", false,
                              &text, &is_null, error) != 0) {
      return -1;
    }
    if(text || is_null) {
      if(set_owned_profile_string(&out->owned_default_user_agent,
                                  &out->runtime_profile.default_user_agent,
                                  text) != 0) {
        return -1;
      }
    }
    if(expect_long(defaults, "httpVersion", "$.runtimeProfile.defaults",
                   false, &long_value, &seen, error) != 0) {
      return -1;
    }
    if(seen) {
      out->runtime_profile.default_http_version = long_value;
      out->runtime_profile.default_http_version_is_set = true;
    }
    if(expect_bool(defaults, "followRedirects", "$.runtimeProfile.defaults",
                   false, &bool_value, &seen, error) != 0) {
      return -1;
    }
    if(seen) {
      out->runtime_profile.default_follow_redirects = bool_value;
      out->runtime_profile.default_follow_redirects_is_set = true;
    }
  }

  return 0;
}

int curlparse_json_parse_input_ex(
  const char *json,
  size_t json_len,
  struct CurlparseInput *out,
  struct CurlparseJsonError *error
)
{
  struct CurlparseJsonValue *root;
  const char *schema_version = NULL;
  const char *input_mode = NULL;
  const char *parse_mode = NULL;
  char **argv = NULL;
  size_t argv_count = 0;

  if(error) {
    memset(error, 0, sizeof(*error));
  }
  if(!out) {
    set_error(error, "$", "Parser output is null", "output pointer", "null");
    return -1;
  }

  memset(out, 0, sizeof(*out));
  curlparse_external_refs_init(&out->external_refs);
  root = parse_document(json, json_len, error);
  if(!root) {
    curlparse_json_free_input(out);
    return -1;
  }
  if(root->type != CURLPARSE_JSON_OBJECT) {
    set_error(error, "$", "Parse input must be an object",
              "object", json_type_name(root));
    json_value_free(root);
    curlparse_json_free_input(out);
    return -1;
  }

  if(expect_string(root, "schemaVersion", "$", true,
                   &schema_version, error) != 0) {
    json_value_free(root);
    curlparse_json_free_input(out);
    return -1;
  }
  if(strcmp(schema_version, "curl-parse-input/v1") != 0) {
    set_error(error, "$.schemaVersion", "Unsupported schema version",
              "\"curl-parse-input/v1\"", schema_version);
    json_value_free(root);
    curlparse_json_free_input(out);
    return -1;
  }

  if(expect_string(root, "inputMode", "$", false, &input_mode, error) != 0) {
    json_value_free(root);
    curlparse_json_free_input(out);
    return -1;
  }
  if(input_mode && strcmp(input_mode, "argv") != 0) {
    set_error(error, "$.inputMode", "Unsupported input mode",
              "\"argv\"", input_mode);
    json_value_free(root);
    curlparse_json_free_input(out);
    return -1;
  }

  if(copy_string_array(root, "argv", "$", true, false,
                       &argv, &argv_count, NULL, error) != 0) {
    json_value_free(root);
    curlparse_json_free_input(out);
    return -1;
  }
  if(argv_count == 0U) {
    set_error(error, "$.argv", "argv must not be empty",
              "non-empty array", "empty array");
    free_string_array(argv, argv_count);
    json_value_free(root);
    curlparse_json_free_input(out);
    return -1;
  }

  out->argv = (const char **)argv;
  out->argv_count = argv_count;

  if(parse_runtime_profile(root, out, error) != 0) {
    json_value_free(root);
    curlparse_json_free_input(out);
    return -1;
  }

  if(reject_removed_host_fields(root, error) != 0) {
    json_value_free(root);
    curlparse_json_free_input(out);
    return -1;
  }

  out->parse_mode = "strict";
  if(expect_string(root, "parseMode", "$", false, &parse_mode, error) != 0) {
    json_value_free(root);
    curlparse_json_free_input(out);
    return -1;
  }
  if(parse_mode) {
    if(strcmp(parse_mode, "strict") != 0 &&
       strcmp(parse_mode, "diagnostic") != 0) {
      set_error(error, "$.parseMode", "Unsupported parse mode",
                "\"strict\" or \"diagnostic\"", parse_mode);
      json_value_free(root);
      curlparse_json_free_input(out);
      return -1;
    }
    out->owned_parse_mode = curlparse_strdup(parse_mode);
    if(!out->owned_parse_mode) {
      json_value_free(root);
      curlparse_json_free_input(out);
      return -1;
    }
    out->parse_mode = out->owned_parse_mode;
  }

  json_value_free(root);
  return 0;
}

int curlparse_json_parse_input(
  const char *json,
  size_t json_len,
  struct CurlparseInput *out
)
{
  return curlparse_json_parse_input_ex(json, json_len, out, NULL);
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
  free(input->owned_option_catalog_curl_version);
  free(input->owned_option_catalog_source);
  free(input->owned_option_catalog_sha256);
  free(input->owned_ssl_backend);
  free(input->owned_http3_backend);
  free(input->owned_resolver_backend);
  free(input->owned_default_user_agent);
  free(input->owned_parse_mode);
  curlparse_external_refs_free(&input->external_refs);
  memset(input, 0, sizeof(*input));
}
