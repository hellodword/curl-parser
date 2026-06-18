#ifndef CURLPARSE_SERIALIZE_CONFIG_H
#define CURLPARSE_SERIALIZE_CONFIG_H

#include <stddef.h>

#include "tool_cfgable.h"

int curlparse_serialize_operations_json(
  const struct GlobalConfig *global_config,
  char **out_json,
  size_t *out_len
);

int curlparse_serialize_operations_array_json(
  const struct GlobalConfig *global_config,
  char **out_json,
  size_t *out_len
);

#endif
