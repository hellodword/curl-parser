#ifndef CURLPARSE_EXTERNAL_REFS_H
#define CURLPARSE_EXTERNAL_REFS_H

#include <stdbool.h>
#include <stddef.h>

struct CurlparseExternalRef {
  char *id;
  char *kind;
  char *access;
  char *option;
  char *value;
  unsigned argv_index;
  bool has_argv_index;
};

struct CurlparseExternalRefs {
  struct CurlparseExternalRef *items;
  size_t count;
};

void curlparse_external_refs_init(struct CurlparseExternalRefs *refs);
void curlparse_external_refs_free(struct CurlparseExternalRefs *refs);

int curlparse_external_refs_add(
  struct CurlparseExternalRefs *refs,
  const char *kind,
  const char *access,
  const char *option,
  const char *value,
  unsigned argv_index,
  bool has_argv_index,
  char *out_id,
  size_t out_id_size
);

const struct CurlparseExternalRef *curlparse_external_refs_find(
  const struct CurlparseExternalRefs *refs,
  const char *option,
  const char *value,
  unsigned argv_index,
  bool has_argv_index
);

#endif
