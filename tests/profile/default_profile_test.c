#include "curlparse_profile.h"

#include <assert.h>

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

  return 0;
}
