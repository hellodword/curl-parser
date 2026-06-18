#include "api/curlparse_api.h"

#include <assert.h>
#include <stdint.h>
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
    "\"inputMode\":\"argv\","
    "\"argv\":[\"curl\",\"https://example.com\"]"
    "}";
  static const char command_input_json[] =
    "{"
    "\"inputMode\":\"command\","
    "\"command\":\"curl https://example.com\""
    "}";
  uint32_t input_ptr;
  uint32_t pair_ptr;
  unsigned char *pair_memory;
  char *input_memory;
  const char *output_memory;
  uint32_t output_ptr;
  uint32_t output_len;

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

  assert(curlparse_parse(input_ptr, (uint32_t)(sizeof(argv_input_json) - 1U),
                         pair_ptr) == 0);

  output_ptr = read_u32_le(pair_memory);
  output_len = read_u32_le(pair_memory + 4);
  output_memory = curlparse_native_ptr(output_ptr, output_len);

  assert(output_memory != NULL);
  assert(strstr(output_memory, "\"ok\":true") != NULL);
  assert(strstr(output_memory, "\"schemaVersion\":\"1.0\"") != NULL);
  assert(strstr(output_memory, "\"argv\":[\"curl\",\"https://example.com\"]") != NULL);
  assert(strstr(output_memory, "\"operations\":[") != NULL);
  assert(strstr(output_memory, "\"events\":[") != NULL);

  input_ptr = curlparse_alloc((uint32_t)(sizeof(command_input_json) - 1U));
  pair_ptr = curlparse_alloc(8U);
  input_memory = curlparse_native_ptr(input_ptr,
                                      (uint32_t)(sizeof(command_input_json) - 1U));
  assert(input_ptr != 0U);
  assert(pair_ptr != 0U);
  assert(input_memory != NULL);
  memcpy(input_memory, command_input_json, sizeof(command_input_json) - 1U);
  assert(curlparse_parse(input_ptr,
                         (uint32_t)(sizeof(command_input_json) - 1U),
                         pair_ptr) == -2);

  return 0;
}
