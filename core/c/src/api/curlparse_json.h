#ifndef CURLPARSE_JSON_H
#define CURLPARSE_JSON_H

#include <stdbool.h>
#include <stddef.h>

#include "io/curlparse_external_refs.h"
#include "runtime/curlparse_profile.h"

struct CurlparseJsonError {
  const char *code;
  const char *severity;
  const char *category;
  char message[128];
  char path[128];
  char expected[128];
  char actual[128];
};

struct CurlparseInput {
  const char **argv;
  size_t argv_count;
  struct CurlparseProfile runtime_profile;
  struct CurlparseExternalRefs external_refs;
  bool runtime_profile_defaulted;
  const char *parse_mode;

  char **owned_protocols;
  size_t owned_protocol_count;
  char **owned_features;
  size_t owned_feature_count;
  char **owned_available_options;
  size_t owned_available_option_count;
  char **owned_disabled_options;
  size_t owned_disabled_option_count;
  char **owned_defines;
  size_t owned_define_count;
  char *owned_curl_version;
  char *owned_option_catalog_curl_version;
  char *owned_option_catalog_source;
  char *owned_option_catalog_sha256;
  char *owned_ssl_backend;
  char *owned_http3_backend;
  char *owned_resolver_backend;
  char *owned_default_user_agent;
  char *owned_parse_mode;
};

int curlparse_json_parse_input(
  const char *json,
  size_t json_len,
  struct CurlparseInput *out
);

int curlparse_json_parse_input_ex(
  const char *json,
  size_t json_len,
  struct CurlparseInput *out,
  struct CurlparseJsonError *error
);

void curlparse_json_free_input(struct CurlparseInput *input);

#endif
