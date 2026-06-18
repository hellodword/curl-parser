#ifndef CURLPARSE_LIBINFO_H
#define CURLPARSE_LIBINFO_H

#include "runtime/curlparse_curl_compat.h"

#include "tool_libinfo.h"

#include "curlparse_profile.h"

void curlparse_reset_libinfo(void);
void curlparse_apply_libinfo_profile(const struct CurlparseProfile *profile);

#endif
