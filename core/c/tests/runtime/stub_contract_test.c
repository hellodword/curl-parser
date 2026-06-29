#include "runtime/curlparse_stub_contract.h"

#include <assert.h>
#include <stdlib.h>
#include <string.h>

#include "curl/curl.h"

int main(void)
{
  const struct CurlparseStubContract *contract;
  char *escaped;

  contract = curlparse_stub_contract_find("curl_easy_escape");
  assert(contract != NULL);
  assert(strcmp(contract->level, "approximated") == 0);

  curlparse_stub_contract_reset();
  escaped = curl_easy_escape(NULL, "a b", -1);
  assert(escaped != NULL);
  assert(strcmp(escaped, "a b") == 0);
  curl_free(escaped);
  assert(curlparse_stub_contract_used_count() == 1U);
  contract = curlparse_stub_contract_used(0);
  assert(contract != NULL);
  assert(strcmp(contract->name, "curl_easy_escape") == 0);
  assert(strcmp(contract->level, "approximated") == 0);

  curlparse_stub_contract_reset();
  assert(curl_mime_filedata(NULL, "payload.txt") != CURLE_OK);
  assert(curlparse_stub_contract_used_count() == 1U);
  contract = curlparse_stub_contract_used(0);
  assert(contract != NULL);
  assert(strcmp(contract->name, "curl_mime_filedata") == 0);
  assert(strcmp(contract->level, "unimplemented-loud") == 0);

  return 0;
}
