#ifndef CURLPARSE_CORE_H
#define CURLPARSE_CORE_H

#include <stdbool.h>
#include <stddef.h>

#include "runtime/curlparse_profile.h"
#include "tool_getparam.h"

struct CurlparseCoreResult {
  ParameterError parse_error;
  size_t operation_count;
  size_t event_count;
  bool runtime_profile_applied;
  bool profile_feature_http3_enabled;
  bool profile_protocol_https_enabled;
};

int curlparse_core_parse(
  const char *const *argv,
  size_t argc,
  const struct CurlparseProfile *profile,
  struct CurlparseCoreResult *out
);

#endif
