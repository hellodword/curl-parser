#include "api/curlparse_api.h"

#include <stdlib.h>
#include <string.h>

#include "api/curlparse_json.h"
#include "api/curlparse_result.h"
#include "capture/curlparse_event_scan.h"
#include "capture/curlparse_serialize_config.h"
#include "runtime/curlparse_libinfo.h"
#include "runtime/curlparse_option_guard.h"
#include "tool_cfgable.h"
#include "tool_stderr.h"

#ifndef CURLPARSE_WASM
#define CURLPARSE_HEAP_ALIGNMENT 8U
#define CURLPARSE_HEAP_INITIAL_SIZE 4096U
#define CURLPARSE_HEAP_RESERVED 8U

struct CurlparseHeap {
  unsigned char *data;
  uint32_t size;
  uint32_t used;
};

static struct CurlparseHeap g_heap;
#endif

#ifndef CURLPARSE_WASM
static uint32_t align_size(uint32_t size)
{
  return (size + (CURLPARSE_HEAP_ALIGNMENT - 1U)) &
         ~(CURLPARSE_HEAP_ALIGNMENT - 1U);
}

static int ensure_heap_capacity(uint32_t required)
{
  unsigned char *grown;
  uint32_t new_size = g_heap.size ? g_heap.size : CURLPARSE_HEAP_INITIAL_SIZE;

  if(required <= g_heap.size) {
    return 0;
  }

  while(new_size < required) {
    new_size *= 2U;
  }

  grown = realloc(g_heap.data, new_size);
  if(!grown) {
    return -1;
  }

  memset(grown + g_heap.size, 0, new_size - g_heap.size);
  g_heap.data = grown;
  g_heap.size = new_size;
  if(g_heap.used < CURLPARSE_HEAP_RESERVED) {
    g_heap.used = CURLPARSE_HEAP_RESERVED;
  }
  return 0;
}

static void reset_native_heap(void)
{
  if(g_heap.data && g_heap.size) {
    memset(g_heap.data, 0, g_heap.size);
  }
  g_heap.used = CURLPARSE_HEAP_RESERVED;
}
#endif

void *curlparse_native_ptr(uint32_t ptr, uint32_t size)
{
#ifdef CURLPARSE_WASM
  (void)size;
  if(ptr == 0U || size == 0U) {
    return NULL;
  }
  return (void *)(uintptr_t)ptr;
#else
  uint64_t end;

  if(ptr < CURLPARSE_HEAP_RESERVED || size == 0U || !g_heap.data) {
    return NULL;
  }

  end = (uint64_t)ptr + (uint64_t)size;
  if(end > g_heap.used) {
    return NULL;
  }

  return g_heap.data + ptr;
#endif
}

static void write_u32_le(unsigned char *target, uint32_t value)
{
  target[0] = (unsigned char)(value & 0xffU);
  target[1] = (unsigned char)((value >> 8) & 0xffU);
  target[2] = (unsigned char)((value >> 16) & 0xffU);
  target[3] = (unsigned char)((value >> 24) & 0xffU);
}

static uint32_t read_u32_le(const unsigned char *source)
{
  return (uint32_t)source[0] |
         ((uint32_t)source[1] << 8) |
         ((uint32_t)source[2] << 16) |
         ((uint32_t)source[3] << 24);
}

uint32_t curlparse_abi_version(void)
{
  return 1U;
}

uint32_t curlparse_alloc(uint32_t size)
{
#ifdef CURLPARSE_WASM
  void *ptr;

  if(size == 0U) {
    return 0U;
  }

  ptr = malloc(size);
  if(!ptr) {
    return 0U;
  }

  memset(ptr, 0, size);
  return (uint32_t)(uintptr_t)ptr;
#else
  uint32_t offset;
  uint32_t aligned_size;
  uint32_t required;

  if(size == 0U) {
    return 0U;
  }

  aligned_size = align_size(size);
  if(g_heap.used < CURLPARSE_HEAP_RESERVED) {
    g_heap.used = CURLPARSE_HEAP_RESERVED;
  }

  if(aligned_size > UINT32_MAX - g_heap.used) {
    return 0U;
  }

  offset = g_heap.used;
  required = g_heap.used + aligned_size;
  if(ensure_heap_capacity(required) != 0) {
    return 0U;
  }

  g_heap.used = required;
  return offset;
#endif
}

void curlparse_free(uint32_t ptr, uint32_t size)
{
  void *target = curlparse_native_ptr(ptr, size);

  if(target && size) {
    memset(target, 0, size);
#ifdef CURLPARSE_WASM
    free(target);
#endif
  }
}

int32_t curlparse_parse(
  uint32_t input_ptr,
  uint32_t input_len,
  uint32_t out_pair_ptr
)
{
  const char *input_json;
  unsigned char *out_pair;
  struct CurlparseInput input;
  struct CurlparseEventScan scan;
  struct CurlparseGuardReport report;
  char *output_json = NULL;
  char *operations_json = NULL;
  size_t output_len = 0;
  uint32_t output_ptr;
  void *output_memory;
  CURLcode init_rc;
  ParameterError parse_error = PARAM_OK;
  bool global_initialized = false;

  input_json = curlparse_native_ptr(input_ptr, input_len);
  if(!input_json) {
    return -1;
  }

  out_pair = curlparse_native_ptr(out_pair_ptr, 8U);
  if(!out_pair) {
    return -4;
  }

  memset(&scan, 0, sizeof(scan));
  memset(&report, 0, sizeof(report));

  if(curlparse_json_parse_input(input_json, input_len, &input) != 0) {
    return -2;
  }

  if(curlparse_scan_events(input.argv, input.argv_count, &scan) != 0) {
    curlparse_json_free_input(&input);
    return -3;
  }

  tool_init_stderr();
  init_rc = globalconf_init();
  if(init_rc != CURLE_OK) {
    curlparse_event_scan_free(&scan);
    curlparse_json_free_input(&input);
    return -3;
  }
  global_initialized = true;

  curlparse_apply_libinfo_profile(&input.runtime_profile);
  parse_error = parse_args((int)input.argv_count, (argv_item_t *)input.argv);

  if(curlparse_serialize_operations_array_json(global, &operations_json, &output_len) != 0 ||
     curlparse_apply_option_guards(&input.runtime_profile,
                                   &scan,
                                   input.parse_mode,
                                   &report) != 0 ||
     curlparse_render_parse_result(&input,
                                   &scan,
                                   operations_json ? operations_json : "[]",
                                   &report,
                                   parse_error,
                                   &output_json,
                                   &output_len) != 0) {
    free(operations_json);
    if(global_initialized) {
      globalconf_free();
    }
    curlparse_guard_report_free(&report);
    curlparse_event_scan_free(&scan);
    curlparse_json_free_input(&input);
    return -3;
  }

  free(operations_json);
  if(global_initialized) {
    globalconf_free();
  }

  output_ptr = curlparse_alloc((uint32_t)output_len);
  if(!output_ptr) {
    free(output_json);
    curlparse_guard_report_free(&report);
    curlparse_event_scan_free(&scan);
    curlparse_json_free_input(&input);
    return -3;
  }

  output_memory = curlparse_native_ptr(output_ptr, (uint32_t)output_len);
  if(!output_memory) {
    free(output_json);
    curlparse_guard_report_free(&report);
    curlparse_event_scan_free(&scan);
    curlparse_json_free_input(&input);
    return -3;
  }

  memcpy(output_memory, output_json, output_len);
  write_u32_le(out_pair, output_ptr);
  write_u32_le(out_pair + 4, (uint32_t)output_len);

  free(output_json);
  curlparse_guard_report_free(&report);
  curlparse_event_scan_free(&scan);
  curlparse_json_free_input(&input);
  return 0;
}

int curlparse_parse_native_json(
  const char *input_json,
  char **out_json,
  size_t *out_len
)
{
  uint32_t input_ptr;
  uint32_t pair_ptr;
  uint32_t output_ptr;
  uint32_t output_size;
  unsigned char *pair_memory;
  char *input_memory;
  const char *output_memory;
  char *copy;
  size_t input_len;
  int32_t parse_rc;

  if(!input_json || !out_json || !out_len) {
    return -1;
  }

  *out_json = NULL;
  *out_len = 0;
  input_len = strlen(input_json);

#ifndef CURLPARSE_WASM
  reset_native_heap();
#endif

  input_ptr = curlparse_alloc((uint32_t)input_len);
  pair_ptr = curlparse_alloc(8U);
  if(!input_ptr || !pair_ptr) {
    return -3;
  }

  input_memory = curlparse_native_ptr(input_ptr, (uint32_t)input_len);
  pair_memory = curlparse_native_ptr(pair_ptr, 8U);
  if(!input_memory || !pair_memory) {
    return -1;
  }

  memcpy(input_memory, input_json, input_len);
  parse_rc = curlparse_parse(input_ptr, (uint32_t)input_len, pair_ptr);
  if(parse_rc != 0) {
    return (int)parse_rc;
  }

  output_ptr = read_u32_le(pair_memory);
  output_size = read_u32_le(pair_memory + 4);
  output_memory = curlparse_native_ptr(output_ptr, output_size);
  if(!output_memory) {
    return -1;
  }

  copy = malloc((size_t)output_size + 1U);
  if(!copy) {
    return -3;
  }

  memcpy(copy, output_memory, output_size);
  copy[output_size] = '\0';
  *out_json = copy;
  *out_len = output_size;
  return 0;
}
