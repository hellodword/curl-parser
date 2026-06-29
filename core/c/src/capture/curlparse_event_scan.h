#ifndef CURLPARSE_EVENT_SCAN_H
#define CURLPARSE_EVENT_SCAN_H

#include <stdbool.h>
#include <stddef.h>

struct CurlparseOptionEvent {
  unsigned operation_index;
  unsigned argv_index;

  const char *raw_flag;
  const char *canonical;

  bool has_value;
  const char *value;
  unsigned value_argv_index;

  bool used_nextarg;
  bool negated;
  bool is_next;
  bool is_positional;
};

struct CurlparseEventScan {
  struct CurlparseOptionEvent *events;
  size_t event_count;
};

int curlparse_scan_events(
  const char *const *argv,
  size_t argc,
  struct CurlparseEventScan *out
);

void curlparse_event_scan_free(struct CurlparseEventScan *scan);

#endif
