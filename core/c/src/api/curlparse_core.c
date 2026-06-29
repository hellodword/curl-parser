#include "api/curlparse_core.h"

#include <string.h>

#include "capture/curlparse_event_scan.h"
#include "runtime/curlparse_libinfo.h"
#include "tool_cfgable.h"
#include "tool_stderr.h"

static size_t count_operations(void)
{
  const struct OperationConfig *config;
  size_t count = 0;

  for(config = global ? global->first : NULL; config; config = config->next) {
    ++count;
  }

  return count;
}

int curlparse_core_parse(
  const char *const *argv,
  size_t argc,
  const struct CurlparseProfile *profile,
  struct CurlparseCoreResult *out
)
{
  struct CurlparseEventScan scan;
  struct CurlparseProfile default_profile;
  CURLcode init_rc;

  if(!argv || !argc || !out) {
    return -1;
  }

  memset(out, 0, sizeof(*out));
  memset(&scan, 0, sizeof(scan));

  if(!profile) {
    curlparse_profile_default(&default_profile);
    profile = &default_profile;
  }

  if(curlparse_scan_events(argv, argc, &scan) != 0) {
    return -2;
  }

  tool_init_stderr();
  init_rc = globalconf_init();
  if(init_rc != CURLE_OK) {
    curlparse_event_scan_free(&scan);
    return -3;
  }

  curlparse_apply_libinfo_profile(profile);
  out->runtime_profile_applied = true;
  out->profile_feature_http3_enabled = feature_http3;
  out->profile_protocol_https_enabled = (proto_https != NULL);

  out->parse_error = parse_args((int)argc, (argv_item_t *)argv);
  out->operation_count = count_operations();
  out->event_count = scan.event_count;

  globalconf_free();
  curlparse_event_scan_free(&scan);
  return 0;
}
