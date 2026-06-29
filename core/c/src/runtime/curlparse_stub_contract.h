#ifndef CURLPARSE_STUB_CONTRACT_H
#define CURLPARSE_STUB_CONTRACT_H

#include <stddef.h>

struct CurlparseStubContract {
  const char *name;
  const char *level;
  const char *summary;
};

void curlparse_stub_contract_reset(void);

const struct CurlparseStubContract *curlparse_stub_contract_find(
  const char *name
);

const struct CurlparseStubContract *curlparse_stub_contract_note(
  const char *name
);

size_t curlparse_stub_contract_used_count(void);

const struct CurlparseStubContract *curlparse_stub_contract_used(
  size_t index
);

#endif
