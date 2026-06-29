#include "capture/curlparse_event_scan.h"

#include <assert.h>
#include <stddef.h>
#include <string.h>

static const struct CurlparseOptionEvent *event_at(
  const struct CurlparseEventScan *scan,
  size_t index
)
{
  assert(index < scan->event_count);
  return &scan->events[index];
}

int main(void)
{
  {
    const char *const argv[] = {"curl", "-H", "A: B", "https://example.com"};
    struct CurlparseEventScan scan;
    const struct CurlparseOptionEvent *event;

    assert(curlparse_scan_events(argv, 4, &scan) == 0);
    assert(scan.event_count == 2);
    event = event_at(&scan, 0);
    assert(strcmp(event->canonical, "header") == 0);
    assert(event->has_value);
    assert(strcmp(event->value, "A: B") == 0);
    assert(event->value_argv_index == 2);
    curlparse_event_scan_free(&scan);
  }

  {
    const char *const argv[] = {"curl", "--header=A:B", "https://example.com"};
    struct CurlparseEventScan scan;
    const struct CurlparseOptionEvent *event;

    assert(curlparse_scan_events(argv, 3, &scan) == 0);
    assert(scan.event_count == 2);
    event = event_at(&scan, 0);
    assert(strcmp(event->canonical, "header") == 0);
    assert(event->has_value);
    assert(strcmp(event->value, "A:B") == 0);
    assert(event->value_argv_index == 1);
    curlparse_event_scan_free(&scan);
  }

  {
    const char *const argv[] = {"curl", "--no-progress-meter",
                                "https://example.com"};
    struct CurlparseEventScan scan;
    const struct CurlparseOptionEvent *event;

    assert(curlparse_scan_events(argv, 3, &scan) == 0);
    assert(scan.event_count == 2);
    event = event_at(&scan, 0);
    assert(strcmp(event->canonical, "progress-meter") == 0);
    assert(event->negated);
    curlparse_event_scan_free(&scan);
  }

  {
    const char *const argv[] = {"curl", "-OLv", "https://example.com/file"};
    struct CurlparseEventScan scan;

    assert(curlparse_scan_events(argv, 3, &scan) == 0);
    assert(scan.event_count == 4);
    assert(strcmp(event_at(&scan, 0)->canonical, "remote-name") == 0);
    assert(strcmp(event_at(&scan, 1)->canonical, "location") == 0);
    assert(strcmp(event_at(&scan, 2)->canonical, "verbose") == 0);
    curlparse_event_scan_free(&scan);
  }

  {
    const char *const argv[] = {
      "curl", "https://a.example", "--next", "-d", "x", "https://b.example"
    };
    struct CurlparseEventScan scan;

    assert(curlparse_scan_events(argv, 6, &scan) == 0);
    assert(scan.event_count == 4);
    assert(event_at(&scan, 0)->is_positional);
    assert(event_at(&scan, 1)->is_next);
    assert(event_at(&scan, 1)->operation_index == 0);
    assert(strcmp(event_at(&scan, 2)->canonical, "data") == 0);
    assert(event_at(&scan, 2)->operation_index == 1);
    assert(event_at(&scan, 3)->is_positional);
    assert(event_at(&scan, 3)->operation_index == 1);
    curlparse_event_scan_free(&scan);
  }

  {
    const char *const argv[] = {"curl", "--", "--not-an-option"};
    struct CurlparseEventScan scan;

    assert(curlparse_scan_events(argv, 3, &scan) == 0);
    assert(scan.event_count == 1);
    assert(event_at(&scan, 0)->is_positional);
    assert(strcmp(event_at(&scan, 0)->value, "--not-an-option") == 0);
    curlparse_event_scan_free(&scan);
  }

  return 0;
}
