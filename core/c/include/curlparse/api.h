#ifndef CURLPARSE_API_H
#define CURLPARSE_API_H

#include <stddef.h>
#include <stdint.h>

uint32_t curlparse_abi_version(void);
uint32_t curlparse_alloc(uint32_t size);
void curlparse_free(uint32_t ptr, uint32_t size);
void curlparse_buf_free(uint32_t ptr, uint32_t size);

uint32_t curlparse_engine_new(void);
void curlparse_engine_free(uint32_t engine);

int32_t curlparse_parse_json(
  uint32_t engine,
  uint32_t input_ptr,
  uint32_t input_len,
  uint32_t out_pair_ptr
);

void *curlparse_native_ptr(uint32_t ptr, uint32_t size);

int curlparse_parse_native_json(
  const char *input_json,
  char **out_json,
  size_t *out_len
);

#endif
