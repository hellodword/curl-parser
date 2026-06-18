#include "runtime/curlparse_libinfo.h"

#include <assert.h>

int main(void)
{
  static const char *const protocols[] = {"http", "https"};
  static const char *const features[] = {"SSL", "HTTP2"};
  struct CurlparseProfile profile = {
    .curl_version = "8.20.0",
    .protocols = protocols,
    .protocol_count = 2,
    .features = features,
    .feature_count = 2,
    .available_options = NULL,
    .available_option_count = 0,
    .available_options_is_set = false,
    .disabled_options = NULL,
    .disabled_option_count = 0,
    .defines = NULL,
    .define_count = 0,
  };

  curlparse_apply_libinfo_profile(&profile);

  assert(proto_http != NULL);
  assert(proto_https != NULL);
  assert(proto_sftp == NULL);
  assert(proto_token("http") == proto_http);
  assert(proto_token("https") == proto_https);

  assert(feature_ssl == TRUE);
  assert(feature_http2 == TRUE);
  assert(feature_http3 == FALSE);
  assert(feature_names[0] != NULL);
  assert(feature_count == 2);

  curlparse_reset_libinfo();
  assert(proto_http == NULL);
  assert(feature_ssl == FALSE);

  return 0;
}
