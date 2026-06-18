#include "curlparse_profile.h"

#include <stddef.h>
#include <string.h>

#define ARRAY_SIZE(a) (sizeof(a) / sizeof((a)[0]))

static const char *const default_protocols[] = {
  "dict", "file", "ftp", "ftps", "gopher", "gophers",
  "http", "https", "imap", "imaps", "ipfs", "ipns",
  "mqtt", "mqtts", "pop3", "pop3s", "rtsp", "scp",
  "sftp", "smtp", "smtps", "telnet", "tftp"
};

static const char *const default_features[] = {
  "alt-svc", "AsynchDNS", "brotli", "GSS-API", "HSTS",
  "HTTP2", "HTTP3", "HTTPS-proxy", "IDN", "IPv6",
  "Kerberos", "Largefile", "libz", "PSL", "SPNEGO",
  "SSL", "threadsafe", "TLS-SRP", "UnixSockets", "zstd"
};

static const char *const empty_list[] = {};

static bool list_contains(
  const char *const *items,
  size_t count,
  const char *needle
)
{
  size_t i;
  if(!items || !needle) {
    return false;
  }

  for(i = 0; i < count; ++i) {
    if(items[i] && strcmp(items[i], needle) == 0) {
      return true;
    }
  }

  return false;
}

bool curlparse_profile_has_protocol(
  const struct CurlparseProfile *profile,
  const char *name
)
{
  if(!profile) {
    return false;
  }
  return list_contains(profile->protocols, profile->protocol_count, name);
}

bool curlparse_profile_has_feature(
  const struct CurlparseProfile *profile,
  const char *name
)
{
  if(!profile) {
    return false;
  }
  return list_contains(profile->features, profile->feature_count, name);
}

bool curlparse_profile_has_define(
  const struct CurlparseProfile *profile,
  const char *name
)
{
  if(!profile) {
    return false;
  }
  return list_contains(profile->defines, profile->define_count, name);
}

bool curlparse_profile_option_available(
  const struct CurlparseProfile *profile,
  const char *canonical_option
)
{
  if(!profile || !canonical_option) {
    return false;
  }

  if(list_contains(profile->disabled_options, profile->disabled_option_count,
                   canonical_option)) {
    return false;
  }

  if(!profile->available_options_is_set) {
    return true;
  }

  return list_contains(profile->available_options,
                       profile->available_option_count,
                       canonical_option);
}

void curlparse_profile_default(struct CurlparseProfile *out)
{
  if(!out) {
    return;
  }

  out->curl_version = "8.20.0";
  out->protocols = default_protocols;
  out->protocol_count = ARRAY_SIZE(default_protocols);
  out->features = default_features;
  out->feature_count = ARRAY_SIZE(default_features);
  out->available_options = empty_list;
  out->available_option_count = 0;
  out->available_options_is_set = false;
  out->disabled_options = empty_list;
  out->disabled_option_count = 0;
  out->defines = empty_list;
  out->define_count = 0;
}
