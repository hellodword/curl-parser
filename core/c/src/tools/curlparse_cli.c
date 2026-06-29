#include "curlparse/api.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int read_all_stdin(char **out_buffer, size_t *out_len)
{
  char *buffer = NULL;
  size_t length = 0;
  size_t capacity = 0;

  for(;;) {
    size_t available;
    size_t nread;
    char *grown;

    if(length == capacity) {
      size_t new_capacity = capacity ? (capacity * 2U) : 4096U;
      grown = realloc(buffer, new_capacity);
      if(!grown) {
        free(buffer);
        return -1;
      }
      buffer = grown;
      capacity = new_capacity;
    }

    available = capacity - length;
    nread = fread(buffer + length, 1, available, stdin);
    length += nread;

    if(nread < available) {
      if(ferror(stdin)) {
        free(buffer);
        return -1;
      }
      break;
    }
  }

  if(!buffer) {
    buffer = malloc(1U);
    if(!buffer) {
      return -1;
    }
  }
  buffer[length] = '\0';
  *out_buffer = buffer;
  *out_len = length;
  return 0;
}

int main(void)
{
  char *input_json = NULL;
  char *output_json = NULL;
  size_t input_len = 0;
  size_t output_len = 0;
  int rc;

  if(read_all_stdin(&input_json, &input_len) != 0) {
    fprintf(stderr, "failed to read stdin\n");
    return 1;
  }

  if(input_len == 0) {
    fprintf(stderr, "stdin is empty\n");
    free(input_json);
    return 1;
  }

  rc = curlparse_parse_native_json(input_json, &output_json, &output_len);
  free(input_json);
  if(rc != 0) {
    fprintf(stderr, "curlparse_parse_native_json failed: %d\n", rc);
    free(output_json);
    return 1;
  }

  if(fwrite(output_json, 1, output_len, stdout) != output_len) {
    fprintf(stderr, "failed to write stdout\n");
    free(output_json);
    return 1;
  }
  fputc('\n', stdout);
  free(output_json);
  return 0;
}
