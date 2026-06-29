#include "runtime/curlparse_option_guard.h"

#include <assert.h>
#include <string.h>

static void scan(
  const char *const *argv,
  size_t argc,
  struct CurlparseEventScan *scan_out
)
{
  assert(curlparse_scan_events(argv, argc, scan_out) == 0);
}

int main(void)
{
  struct CurlparseProfile profile;
  struct CurlparseEventScan scan_out;
  struct CurlparseGuardReport report;
  static const char *const http_protocols[] = {"http", "https"};
  static const char *const http_features[] = {"SSL", "HTTP2", "HTTP3"};
  static const char *const no_http3_features[] = {"SSL", "HTTP2"};
  static const char *const proxy_missing_features[] = {"SSL", "HTTP2", "HTTP3"};
  static const char *const disabled_options[] = {"ipfs-gateway"};

  {
    const char *const argv[] = {"curl", "--http3", "https://example.com"};
    profile = (struct CurlparseProfile){
      .curl_version = "8.20.0",
      .protocols = http_protocols,
      .protocol_count = 2,
      .features = http_features,
      .feature_count = 3,
    };
    scan(argv, 3, &scan_out);
    assert(curlparse_apply_option_guards(&profile, &scan_out, "strict", &report) == 0);
    assert(report.ok);
    assert(report.error_count == 0);
    curlparse_guard_report_free(&report);
    curlparse_event_scan_free(&scan_out);
  }

  {
    const char *const argv[] = {"curl", "--http3", "https://example.com"};
    profile = (struct CurlparseProfile){
      .curl_version = "8.20.0",
      .protocols = http_protocols,
      .protocol_count = 2,
      .features = no_http3_features,
      .feature_count = 2,
    };
    scan(argv, 3, &scan_out);
    assert(curlparse_apply_option_guards(&profile, &scan_out, "strict", &report) == 0);
    assert(!report.ok);
    assert(report.error_count == 1);
    assert(strcmp(report.errors[0].code, "feature-not-available") == 0);
    assert(strcmp(report.errors[0].detail, "HTTP3") == 0);
    curlparse_guard_report_free(&report);
    curlparse_event_scan_free(&scan_out);
  }

  {
    const char *const argv[] = {"curl", "sftp://example.com/file"};
    profile = (struct CurlparseProfile){
      .curl_version = "8.20.0",
      .protocols = http_protocols,
      .protocol_count = 2,
      .features = http_features,
      .feature_count = 3,
    };
    scan(argv, 2, &scan_out);
    assert(curlparse_apply_option_guards(&profile, &scan_out, "strict", &report) == 0);
    assert(!report.ok);
    assert(report.error_count == 1);
    assert(strcmp(report.errors[0].code, "protocol-not-available") == 0);
    assert(strcmp(report.errors[0].detail, "sftp") == 0);
    curlparse_guard_report_free(&report);
    curlparse_event_scan_free(&scan_out);
  }

  {
    const char *const argv[] = {"curl", "--proto-default", "sftp", "example.com"};
    profile = (struct CurlparseProfile){
      .curl_version = "8.20.0",
      .protocols = http_protocols,
      .protocol_count = 2,
      .features = http_features,
      .feature_count = 3,
    };
    scan(argv, 4, &scan_out);
    assert(curlparse_apply_option_guards(&profile, &scan_out, "strict", &report) == 0);
    assert(!report.ok);
    assert(report.error_count == 1);
    assert(strcmp(report.errors[0].code, "protocol-not-available") == 0);
    assert(strcmp(report.errors[0].detail, "sftp") == 0);
    curlparse_guard_report_free(&report);
    curlparse_event_scan_free(&scan_out);
  }

  {
    const char *const argv[] = {"curl", "--proto", "-madeup", "https://example.com"};
    profile = (struct CurlparseProfile){
      .curl_version = "8.20.0",
      .protocols = http_protocols,
      .protocol_count = 2,
      .features = http_features,
      .feature_count = 3,
    };
    scan(argv, 4, &scan_out);
    assert(curlparse_apply_option_guards(&profile, &scan_out, "strict", &report) == 0);
    assert(report.ok);
    assert(report.error_count == 0);
    assert(report.diagnostic_count == 1);
    assert(strcmp(report.diagnostics[0].code, "protocol-not-available") == 0);
    assert(strcmp(report.diagnostics[0].detail, "madeup") == 0);
    curlparse_guard_report_free(&report);
    curlparse_event_scan_free(&scan_out);
  }

  {
    const char *const argv[] = {
      "curl", "--proxy", "https://proxy.example", "https://example.com"
    };
    profile = (struct CurlparseProfile){
      .curl_version = "8.20.0",
      .protocols = http_protocols,
      .protocol_count = 2,
      .features = proxy_missing_features,
      .feature_count = 3,
    };
    scan(argv, 4, &scan_out);
    assert(curlparse_apply_option_guards(&profile, &scan_out, "strict", &report) == 0);
    assert(!report.ok);
    assert(report.error_count == 1);
    assert(strcmp(report.errors[0].code, "feature-not-available") == 0);
    assert(strcmp(report.errors[0].detail, "HTTPS-proxy") == 0);
    curlparse_guard_report_free(&report);
    curlparse_event_scan_free(&scan_out);
  }

  {
    const char *const argv[] = {
      "curl", "--ipfs-gateway", "https://gw.example", "https://example.com"
    };
    profile = (struct CurlparseProfile){
      .curl_version = "8.20.0",
      .protocols = http_protocols,
      .protocol_count = 2,
      .features = http_features,
      .feature_count = 3,
      .disabled_options = disabled_options,
      .disabled_option_count = 1,
    };
    scan(argv, 4, &scan_out);
    assert(curlparse_apply_option_guards(&profile, &scan_out, "strict", &report) == 0);
    assert(!report.ok);
    assert(report.error_count == 1);
    assert(strcmp(report.errors[0].code,
                  "E_CURL_OPTION_DISABLED_BY_PROFILE") == 0);
    assert(strcmp(report.errors[0].detail,
                  "runtimeProfile.compile.disabledOptions") == 0);
    curlparse_guard_report_free(&report);
    curlparse_event_scan_free(&scan_out);
  }

  return 0;
}
