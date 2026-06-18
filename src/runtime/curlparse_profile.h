#ifndef CURLPARSE_PROFILE_H
#define CURLPARSE_PROFILE_H

#include <stdbool.h>
#include <stddef.h>

struct CurlparseProfile {
  const char *curl_version;

  const char *const *protocols;
  size_t protocol_count;

  const char *const *features;
  size_t feature_count;

  const char *const *available_options;
  size_t available_option_count;
  bool available_options_is_set;

  const char *const *disabled_options;
  size_t disabled_option_count;

  const char *const *defines;
  size_t define_count;
};

bool curlparse_profile_has_protocol(
  const struct CurlparseProfile *profile,
  const char *name
);

bool curlparse_profile_has_feature(
  const struct CurlparseProfile *profile,
  const char *name
);

bool curlparse_profile_has_define(
  const struct CurlparseProfile *profile,
  const char *name
);

bool curlparse_profile_option_available(
  const struct CurlparseProfile *profile,
  const char *canonical_option
);

void curlparse_profile_default(struct CurlparseProfile *out);

#endif
