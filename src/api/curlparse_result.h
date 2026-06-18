#ifndef CURLPARSE_RESULT_H
#define CURLPARSE_RESULT_H

#include <stddef.h>

#include "api/curlparse_json.h"
#include "capture/curlparse_event_scan.h"
#include "runtime/curlparse_option_guard.h"
#include "tool_getparam.h"

int curlparse_render_success_result(
  const struct CurlparseInput *input,
  char **out_json,
  size_t *out_len
);

int curlparse_render_parse_result(
  const struct CurlparseInput *input,
  const struct CurlparseEventScan *scan,
  const char *operations_json,
  const struct CurlparseGuardReport *report,
  ParameterError parse_error,
  char **out_json,
  size_t *out_len
);

#endif
