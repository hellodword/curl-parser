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
    "\"schemaVersion\":\"curl-parse-input/v1\","
    "\"inputMode\":\"argv\","
    "\"argv\":[\"curl\",\"https://example.com\"]"
    "}";
  static const char command_input_json[] =
    "{"
    "\"schemaVersion\":\"curl-parse-input/v1\","
    "\"inputMode\":\"command\","
    "\"command\":\"curl https://example.com\""
    "}";
  static const char duplicate_input_json[] =
    "{"
    "\"schemaVersion\":\"curl-parse-input/v1\","
    "\"inputMode\":\"argv\","
    "\"inputMode\":\"argv\","
    "\"argv\":[\"curl\",\"https://example.com\"]"
    "}";
  static const char generate_input_json[] =
    "{"
    "\"schemaVersion\":\"curl-generate-input/v1\","
    "\"target\":\"js.fetch\","
    "\"ir\":{"
    "\"schemaVersion\":\"curl-ir/v1\","
    "\"curlSourceVersion\":\"8.20.0\","
    "\"command\":{\"inputMode\":\"argv\",\"argv\":[\"curl\",\"--http3\",\"https://example.com\"]},"
    "\"runtime\":{\"profile\":{\"schemaVersion\":\"curl-runtime-profile/v1\"}},"
    "\"externalRefs\":[],"
    "\"globals\":{},"
    "\"groups\":[{\"id\":\"group-0\",\"index\":0,\"options\":{},"
    "\"transfers\":[{\"id\":\"transfer-0\",\"index\":0,\"url\":\"https://example.com\","
    "\"effective\":{\"method\":{\"value\":\"GET\",\"source\":\"default\"},"
    "\"headers\":[],\"body\":null,\"auth\":{},\"cookies\":[],\"proxy\":null,"
    "\"tls\":{},\"httpVersion\":\"3\"}}]}],"
    "\"diagnostics\":[]"
    "}"
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

  assert(curlparse_abi_version() == 1U);
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
  assert(strstr(output_memory, "\"schemaVersion\":\"curl-parse-output/v1\"") != NULL);
  assert(strstr(output_memory, "\"schemaVersion\":\"curl-runtime-profile/v1\"") != NULL);
  assert(strstr(output_memory, "\"argv\":[\"curl\",\"https://example.com\"]") != NULL);
  assert(strstr(output_memory, "\"operations\":[") != NULL);
  assert(strstr(output_memory, "\"events\":[") != NULL);

  input_ptr = curlparse_alloc((uint32_t)(sizeof(generate_input_json) - 1U));
  pair_ptr = curlparse_alloc(8U);
  input_memory = curlparse_native_ptr(input_ptr,
                                      (uint32_t)(sizeof(generate_input_json) - 1U));
  pair_memory = curlparse_native_ptr(pair_ptr, 8U);
  assert(input_ptr != 0U);
  assert(pair_ptr != 0U);
  assert(input_memory != NULL);
  assert(pair_memory != NULL);
  memcpy(input_memory, generate_input_json, sizeof(generate_input_json) - 1U);
  assert(curlparse_generate_json(engine,
                                 input_ptr,
                                 (uint32_t)(sizeof(generate_input_json) - 1U),
                                 pair_ptr) == 0);
  output_ptr = read_u32_le(pair_memory);
  output_len = read_u32_le(pair_memory + 4);
  output_memory = curlparse_native_ptr(output_ptr, output_len);
  assert(output_memory != NULL);
  assert(strstr(output_memory, "\"schemaVersion\":\"curl-generate-output/v1\"") != NULL);
  assert(strstr(output_memory, "\"target\":\"js.fetch\"") != NULL);
  assert(strstr(output_memory, "\"behavior\":\"http.version.3\"") != NULL);
  assert(strstr(output_memory, "\"capability\":\"unsupported\"") != NULL);
  assert(strstr(output_memory, "\"level\":\"unsupported\"") != NULL);
  assert(strstr(output_memory, "\"code\":\"E_TARGET_UNSUPPORTED\"") != NULL);

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
