#include "curlparse/api.h"

#include <assert.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

static uint32_t read_u32_le(const unsigned char *src)
{
  return (uint32_t)src[0] |
         ((uint32_t)src[1] << 8) |
         ((uint32_t)src[2] << 16) |
         ((uint32_t)src[3] << 24);
}

int main(void)
{
  static const char argv_input_json[] =
    "{"
    "\"schemaVersion\":\"curl-parse-input/v2\","
    "\"inputMode\":\"argv\","
    "\"argv\":[\"curl\",\"https://example.com\"]"
    "}";
  static const char command_input_json[] =
    "{"
    "\"schemaVersion\":\"curl-parse-input/v2\","
    "\"inputMode\":\"command\","
    "\"command\":\"curl https://example.com\""
    "}";
  static const char duplicate_input_json[] =
    "{"
    "\"schemaVersion\":\"curl-parse-input/v2\","
    "\"inputMode\":\"argv\","
    "\"inputMode\":\"argv\","
    "\"argv\":[\"curl\",\"https://example.com\"]"
    "}";
  uint32_t input_ptr;
  uint32_t pair_ptr;
  unsigned char *pair_memory;
  char *input_memory;
  const char *output_memory;
  char *native_output;
  char *huge_input;
  uint32_t output_ptr;
  uint32_t output_len;
  size_t native_output_len;
  size_t huge_len;
  uint32_t engine;

  assert(curlparse_abi_version() == 2U);
  engine = curlparse_engine_new();
  assert(engine != 0U);

  input_ptr = curlparse_alloc((uint32_t)(sizeof(argv_input_json) - 1U));
  pair_ptr = curlparse_alloc(8U);

  assert(input_ptr != 0U);
  assert(pair_ptr != 0U);

  input_memory = curlparse_native_ptr(input_ptr,
                                      (uint32_t)(sizeof(argv_input_json) - 1U));
  pair_memory = curlparse_native_ptr(pair_ptr, 8U);
  assert(input_memory != NULL);
  assert(pair_memory != NULL);

  memcpy(input_memory, argv_input_json, sizeof(argv_input_json) - 1U);

  assert(curlparse_parse_json(engine,
                              input_ptr,
                              (uint32_t)(sizeof(argv_input_json) - 1U),
                              pair_ptr) == 0);

  output_ptr = read_u32_le(pair_memory);
  output_len = read_u32_le(pair_memory + 4);
  output_memory = curlparse_native_ptr(output_ptr, output_len);

  assert(output_memory != NULL);
  assert(strstr(output_memory, "\"ok\":true") != NULL);
  assert(strstr(output_memory, "\"schemaVersion\":\"curl-parse-output/v2\"") != NULL);
  assert(strstr(output_memory, "\"schemaVersion\":\"curl-runtime-profile/v2\"") != NULL);
  assert(strstr(output_memory, "\"argv\":[\"curl\",\"https://example.com\"]") != NULL);
  assert(strstr(output_memory, "\"operations\":[") != NULL);
  assert(strstr(output_memory, "\"events\":[") != NULL);

  input_ptr = curlparse_alloc((uint32_t)(sizeof(command_input_json) - 1U));
  pair_ptr = curlparse_alloc(8U);
  input_memory = curlparse_native_ptr(input_ptr,
                                      (uint32_t)(sizeof(command_input_json) - 1U));
  pair_memory = curlparse_native_ptr(pair_ptr, 8U);
  assert(input_ptr != 0U);
  assert(pair_ptr != 0U);
  assert(input_memory != NULL);
  assert(pair_memory != NULL);
  memcpy(input_memory, command_input_json, sizeof(command_input_json) - 1U);
  assert(curlparse_parse_json(engine,
                              input_ptr,
                              (uint32_t)(sizeof(command_input_json) - 1U),
                              pair_ptr) == 0);
  output_ptr = read_u32_le(pair_memory);
  output_len = read_u32_le(pair_memory + 4);
  output_memory = curlparse_native_ptr(output_ptr, output_len);
  assert(output_memory != NULL);
  assert(strstr(output_memory, "\"code\":\"E_INPUT_SCHEMA_INVALID\"") != NULL);
  assert(strstr(output_memory, "\"path\":\"$.inputMode\"") != NULL);

  native_output = NULL;
  native_output_len = 0;
  assert(curlparse_parse_native_json("{", &native_output, &native_output_len) == 0);
  assert(native_output != NULL);
  assert(strstr(native_output, "\"code\":\"E_INPUT_SCHEMA_INVALID\"") != NULL);
  assert(strstr(native_output, "\"path\":\"$\"") != NULL);
  free(native_output);

  native_output = NULL;
  native_output_len = 0;
  assert(curlparse_parse_native_json(duplicate_input_json,
                                     &native_output,
                                     &native_output_len) == 0);
  assert(native_output != NULL);
  assert(strstr(native_output, "\"code\":\"E_INPUT_SCHEMA_INVALID\"") != NULL);
  assert(strstr(native_output, "Duplicate object key") != NULL);
  assert(strstr(native_output, "\"path\":\"$.inputMode\"") != NULL);
  free(native_output);

  huge_len = 1048577U;
  huge_input = malloc(huge_len + 1U);
  assert(huge_input != NULL);
  memset(huge_input, ' ', huge_len);
  huge_input[huge_len] = '\0';
  native_output = NULL;
  native_output_len = 0;
  assert(curlparse_parse_native_json(huge_input,
                                     &native_output,
                                     &native_output_len) == 0);
  assert(native_output != NULL);
  assert(strstr(native_output, "\"code\":\"E_INPUT_TOO_LARGE\"") != NULL);
  free(native_output);
  free(huge_input);

  curlparse_engine_free(engine);
  assert(curlparse_parse_json(engine,
                              input_ptr,
                              (uint32_t)(sizeof(command_input_json) - 1U),
                              pair_ptr) == -6);

  return 0;
}
