#include "io/curlparse_external_refs.h"

#include <assert.h>
#include <string.h>

int main(void)
{
  struct CurlparseExternalRefs refs;
  const struct CurlparseExternalRef *found;
  char id[32];

  curlparse_external_refs_init(&refs);

  assert(curlparse_external_refs_add(&refs,
                                     "file",
                                     "read",
                                     "--data",
                                     "payload.txt",
                                     2U,
                                     true,
                                     id,
                                     sizeof(id)) == 0);
  assert(strcmp(id, "external-0") == 0);
  assert(refs.count == 1U);
  assert(strcmp(refs.items[0].id, "external-0") == 0);
  assert(strcmp(refs.items[0].kind, "file") == 0);
  assert(strcmp(refs.items[0].access, "read") == 0);
  assert(strcmp(refs.items[0].option, "--data") == 0);
  assert(strcmp(refs.items[0].value, "payload.txt") == 0);
  assert(refs.items[0].has_argv_index);
  assert(refs.items[0].argv_index == 2U);

  found = curlparse_external_refs_find(&refs,
                                       "--data",
                                       "payload.txt",
                                       2U,
                                       true);
  assert(found != NULL);
  assert(strcmp(found->id, "external-0") == 0);

  found = curlparse_external_refs_find(&refs,
                                       "--data",
                                       "payload.txt",
                                       7U,
                                       true);
  assert(found == NULL);

  assert(curlparse_external_refs_add(&refs,
                                     "stdin",
                                     "read",
                                     "--json",
                                     "-",
                                     4U,
                                     true,
                                     id,
                                     sizeof(id)) == 0);
  assert(strcmp(id, "external-1") == 0);
  assert(refs.count == 2U);

  found = curlparse_external_refs_find(&refs, "--json", "-", 0U, false);
  assert(found != NULL);
  assert(strcmp(found->id, "external-1") == 0);

  curlparse_external_refs_free(&refs);
  assert(refs.items == NULL);
  assert(refs.count == 0U);

  return 0;
}
