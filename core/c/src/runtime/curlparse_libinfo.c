#include "runtime/curlparse_libinfo.h"

#include <stdlib.h>
#include <string.h>

static const char *no_protos = NULL;
static const char *no_features = NULL;

static const char **runtime_protocols = NULL;
static const char **runtime_features = NULL;
static curl_version_info_data runtime_curlinfo;

curl_version_info_data *curlinfo = NULL;
const char * const *built_in_protos = &no_protos;
size_t proto_count = 0;

const char * const *feature_names = &no_features;
size_t feature_count = 0;

const char *proto_file = NULL;
const char *proto_ftp = NULL;
const char *proto_ftps = NULL;
const char *proto_http = NULL;
const char *proto_https = NULL;
const char *proto_rtsp = NULL;
const char *proto_scp = NULL;
const char *proto_sftp = NULL;
const char *proto_tftp = NULL;
#ifndef CURL_DISABLE_IPFS
const char *proto_ipfs = NULL;
const char *proto_ipns = NULL;
#endif

bool feature_altsvc = FALSE;
bool feature_brotli = FALSE;
bool feature_hsts = FALSE;
bool feature_http2 = FALSE;
bool feature_http3 = FALSE;
bool feature_httpsproxy = FALSE;
bool feature_libz = FALSE;
bool feature_libssh2 = FALSE;
bool feature_ntlm = FALSE;
bool feature_ntlm_wb = FALSE;
bool feature_spnego = FALSE;
bool feature_ssl = FALSE;
bool feature_tls_srp = FALSE;
bool feature_zstd = FALSE;
bool feature_ech = FALSE;
bool feature_ssls_export = FALSE;

static void clear_protocol_tokens(void)
{
  proto_file = NULL;
  proto_ftp = NULL;
  proto_ftps = NULL;
  proto_http = NULL;
  proto_https = NULL;
  proto_rtsp = NULL;
  proto_scp = NULL;
  proto_sftp = NULL;
  proto_tftp = NULL;
#ifndef CURL_DISABLE_IPFS
  proto_ipfs = NULL;
  proto_ipns = NULL;
#endif
}

static void clear_feature_flags(void)
{
  feature_altsvc = FALSE;
  feature_brotli = FALSE;
  feature_hsts = FALSE;
  feature_http2 = FALSE;
  feature_http3 = FALSE;
  feature_httpsproxy = FALSE;
  feature_libz = FALSE;
  feature_libssh2 = FALSE;
  feature_ntlm = FALSE;
  feature_ntlm_wb = FALSE;
  feature_spnego = FALSE;
  feature_ssl = FALSE;
  feature_tls_srp = FALSE;
  feature_zstd = FALSE;
  feature_ech = FALSE;
  feature_ssls_export = FALSE;
}

static int feature_bit(
  const struct CurlparseProfile *profile,
  const char *name,
  int bit
)
{
  return curlparse_profile_has_feature(profile, name) ? bit : 0;
}

static int profile_feature_bits(const struct CurlparseProfile *profile)
{
  return
    feature_bit(profile, "IPv6", CURL_VERSION_IPV6) |
    feature_bit(profile, "SSL", CURL_VERSION_SSL) |
    feature_bit(profile, "libz", CURL_VERSION_LIBZ) |
    feature_bit(profile, "NTLM", CURL_VERSION_NTLM) |
    feature_bit(profile, "DEBUGBUILD", CURL_VERSION_DEBUG) |
    feature_bit(profile, "AsynchDNS", CURL_VERSION_ASYNCHDNS) |
    feature_bit(profile, "SPNEGO", CURL_VERSION_SPNEGO) |
    feature_bit(profile, "Largefile", CURL_VERSION_LARGEFILE) |
    feature_bit(profile, "IDN", CURL_VERSION_IDN) |
    feature_bit(profile, "TLS-SRP", CURL_VERSION_TLSAUTH_SRP) |
    feature_bit(profile, "NTLM_WB", CURL_VERSION_NTLM_WB) |
    feature_bit(profile, "HTTP2", CURL_VERSION_HTTP2) |
    feature_bit(profile, "GSS-API", CURL_VERSION_GSSAPI) |
    feature_bit(profile, "Kerberos", CURL_VERSION_KERBEROS5) |
    feature_bit(profile, "UnixSockets", CURL_VERSION_UNIX_SOCKETS) |
    feature_bit(profile, "PSL", CURL_VERSION_PSL) |
    feature_bit(profile, "HTTPS-proxy", CURL_VERSION_HTTPS_PROXY) |
    feature_bit(profile, "brotli", CURL_VERSION_BROTLI) |
    feature_bit(profile, "alt-svc", CURL_VERSION_ALTSVC) |
    feature_bit(profile, "HTTP3", CURL_VERSION_HTTP3) |
    feature_bit(profile, "zstd", CURL_VERSION_ZSTD) |
    feature_bit(profile, "HSTS", CURL_VERSION_HSTS) |
    feature_bit(profile, "threadsafe", CURL_VERSION_THREADSAFE);
}

static bool profile_has_feature(
  const struct CurlparseProfile *profile,
  const char *name
)
{
  return curlparse_profile_has_feature(profile, name);
}

static const char **copy_pointer_list(
  const char *const *items,
  size_t count
)
{
  const char **copy;
  size_t i;

  copy = calloc(count + 1, sizeof(*copy));
  if(!copy) {
    return NULL;
  }

  for(i = 0; i < count; ++i) {
    copy[i] = items[i];
  }
  copy[count] = NULL;
  return copy;
}

static const char *find_protocol_token(const char *name)
{
  size_t i;

  if(!runtime_protocols || !name) {
    return NULL;
  }

  for(i = 0; i < proto_count; ++i) {
    if(runtime_protocols[i] && CURL_STRICMP(runtime_protocols[i], name) == 0) {
      return runtime_protocols[i];
    }
  }

  return NULL;
}

void curlparse_reset_libinfo(void)
{
  free(runtime_protocols);
  free(runtime_features);
  runtime_protocols = NULL;
  runtime_features = NULL;

  curlinfo = NULL;
  memset(&runtime_curlinfo, 0, sizeof(runtime_curlinfo));
  built_in_protos = &no_protos;
  proto_count = 0;
  feature_names = &no_features;
  feature_count = 0;

  clear_protocol_tokens();
  clear_feature_flags();
}

void curlparse_apply_libinfo_profile(const struct CurlparseProfile *profile)
{
  struct CurlparseProfile default_profile;

  if(!profile) {
    curlparse_profile_default(&default_profile);
    profile = &default_profile;
  }

  curlparse_reset_libinfo();

  runtime_protocols = copy_pointer_list(profile->protocols, profile->protocol_count);
  runtime_features = copy_pointer_list(profile->features, profile->feature_count);

  if(profile->protocol_count && !runtime_protocols) {
    return;
  }
  if(profile->feature_count && !runtime_features) {
    free(runtime_protocols);
    runtime_protocols = NULL;
    return;
  }

  built_in_protos = runtime_protocols ? runtime_protocols : &no_protos;
  proto_count = profile->protocol_count;
  feature_names = runtime_features ? runtime_features : &no_features;
  feature_count = profile->feature_count;

  runtime_curlinfo.age = CURLVERSION_NOW;
  runtime_curlinfo.version = profile->curl_version;
  runtime_curlinfo.features = profile_feature_bits(profile);
  runtime_curlinfo.protocols = built_in_protos;
  runtime_curlinfo.feature_names = feature_names;
  runtime_curlinfo.ares = profile_has_feature(profile, "AsynchDNS") ?
    "c-ares" : NULL;
  runtime_curlinfo.ares_num = profile_has_feature(profile, "AsynchDNS") ?
    0x010000 : 0;
  runtime_curlinfo.ssl_version = profile_has_feature(profile, "SSL") ?
    "profile-ssl" : NULL;
  curlinfo = &runtime_curlinfo;

  proto_file = find_protocol_token("file");
  proto_ftp = find_protocol_token("ftp");
  proto_ftps = find_protocol_token("ftps");
  proto_http = find_protocol_token("http");
  proto_https = find_protocol_token("https");
  proto_rtsp = find_protocol_token("rtsp");
  proto_scp = find_protocol_token("scp");
  proto_sftp = find_protocol_token("sftp");
  proto_tftp = find_protocol_token("tftp");
#ifndef CURL_DISABLE_IPFS
  proto_ipfs = find_protocol_token("ipfs");
  proto_ipns = find_protocol_token("ipns");
#endif

  feature_altsvc = profile_has_feature(profile, "alt-svc");
  feature_brotli = profile_has_feature(profile, "brotli");
  feature_hsts = profile_has_feature(profile, "HSTS");
  feature_http2 = profile_has_feature(profile, "HTTP2");
  feature_http3 = profile_has_feature(profile, "HTTP3");
  feature_httpsproxy = profile_has_feature(profile, "HTTPS-proxy");
  feature_libz = profile_has_feature(profile, "libz");
  feature_libssh2 = profile_has_feature(profile, "libssh2");
  feature_ntlm = profile_has_feature(profile, "NTLM");
  feature_ntlm_wb = profile_has_feature(profile, "NTLM_WB");
  feature_spnego = profile_has_feature(profile, "SPNEGO");
  feature_ssl = profile_has_feature(profile, "SSL");
  feature_tls_srp = profile_has_feature(profile, "TLS-SRP");
  feature_zstd = profile_has_feature(profile, "zstd");
  feature_ech = profile_has_feature(profile, "ECH");
  feature_ssls_export = profile_has_feature(profile, "SSLS-EXPORT");
}

CURLcode get_libcurl_info(void)
{
  return CURLE_OK;
}

const char *proto_token(const char *proto)
{
  size_t i;

  if(!proto) {
    return NULL;
  }

  for(i = 0; i < proto_count; ++i) {
    if(runtime_protocols[i] && CURL_STRICMP(runtime_protocols[i], proto) == 0) {
      return runtime_protocols[i];
    }
  }

  return NULL;
}
