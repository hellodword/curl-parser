#ifndef CURLPARSE_JSON_H
#define CURLPARSE_JSON_H

#include <stdbool.h>
#include <stddef.h>

#include "runtime/curlparse_profile.h"

struct CurlparseInput {
  const char **argv;
  size_t argv_count;
  struct CurlparseProfile runtime_profile;
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
  char *owned_parse_mode;
};

int curlparse_json_parse_input(
  const char *json,
  size_t json_len,
  struct CurlparseInput *out
);

void curlparse_json_free_input(struct CurlparseInput *input);

#endif
