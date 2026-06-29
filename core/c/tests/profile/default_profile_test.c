#include "curlparse_profile.h"

#include <assert.h>
#include <string.h>

int main(void)
{
  struct CurlparseProfile profile;

  curlparse_profile_default(&profile);

  assert(curlparse_profile_has_protocol(&profile, "http"));
  assert(curlparse_profile_has_protocol(&profile, "https"));
  assert(curlparse_profile_has_protocol(&profile, "sftp"));

  assert(curlparse_profile_has_feature(&profile, "HTTP2"));
  assert(curlparse_profile_has_feature(&profile, "HTTP3"));
  assert(curlparse_profile_has_feature(&profile, "SSL"));
  assert(!curlparse_profile_has_feature(&profile, "NTLM"));

  assert(curlparse_profile_option_available(&profile, "http3"));
  assert(strcmp(profile.option_catalog_curl_version, "8.20.0") == 0);
  assert(strcmp(profile.ssl_backend, "openssl") == 0);
  assert(strcmp(profile.http3_backend, "ngtcp2") == 0);
  assert(strcmp(profile.resolver_backend, "c-ares") == 0);
  assert(profile.default_user_agent == NULL);
  assert(!profile.default_http_version_is_set);
  assert(profile.default_follow_redirects_is_set);
  assert(!profile.default_follow_redirects);

  return 0;
}
