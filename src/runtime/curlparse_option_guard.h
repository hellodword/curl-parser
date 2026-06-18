#ifndef CURLPARSE_OPTION_GUARD_H
#define CURLPARSE_OPTION_GUARD_H

#include <stdbool.h>
#include <stddef.h>

#include "capture/curlparse_event_scan.h"
#include "runtime/curlparse_profile.h"

struct CurlparseGuardMessage {
  const char *code;
  char *option;
  char *detail;
  bool warning;
};

struct CurlparseGuardReport {
  bool ok;
  struct CurlparseGuardMessage *diagnostics;
  size_t diagnostic_count;
  struct CurlparseGuardMessage *errors;
  size_t error_count;
};

int curlparse_apply_option_guards(
  const struct CurlparseProfile *profile,
  const struct CurlparseEventScan *scan,
  const char *parse_mode,
  struct CurlparseGuardReport *out
);

void curlparse_guard_report_free(struct CurlparseGuardReport *report);

#endif
