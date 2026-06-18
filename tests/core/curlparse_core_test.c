#include "api/curlparse_core.h"

#include <assert.h>

static void assert_ok_case(
  const char *const *argv,
  size_t argc,
  size_t expected_operations,
  size_t expected_events
)
{
  struct CurlparseCoreResult result;

  assert(curlparse_core_parse(argv, argc, NULL, &result) == 0);
  assert(result.parse_error == PARAM_OK);
  assert(result.operation_count == expected_operations);
  assert(result.event_count == expected_events);
  assert(result.runtime_profile_applied);
}

int main(void)
{
  {
    const char *const argv[] = {"curl", "https://example.com"};
    assert_ok_case(argv, 2, 1, 1);
  }

  {
    const char *const argv[] = {"curl", "-H", "A: B", "https://example.com"};
    assert_ok_case(argv, 4, 1, 2);
  }

  {
    const char *const argv[] = {
      "curl", "--json", "{\"a\":1}", "https://example.com"
    };
    assert_ok_case(argv, 4, 1, 2);
  }

  {
    const char *const argv[] = {"curl", "--http3", "https://example.com"};
    struct CurlparseCoreResult result;

    assert(curlparse_core_parse(argv, 3, NULL, &result) == 0);
    assert(result.parse_error == PARAM_OK);
    assert(result.operation_count == 1);
    assert(result.event_count == 2);
    assert(result.profile_feature_http3_enabled);
    assert(result.profile_protocol_https_enabled);
  }

  {
    const char *const argv[] = {
      "curl", "https://a.example", "--next", "https://b.example", "--next",
      "https://c.example"
    };
    assert_ok_case(argv, 6, 3, 5);
  }

  return 0;
}
