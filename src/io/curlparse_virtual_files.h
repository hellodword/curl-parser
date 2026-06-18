#ifndef CURLPARSE_VIRTUAL_FILES_H
#define CURLPARSE_VIRTUAL_FILES_H

#include <stdbool.h>
#include <stddef.h>

struct CurlparseVirtualFileEntry {
  char *path;
  char *contents;
};

struct CurlparseVirtualFiles {
  bool load_default_curlrc;
  bool allow_host_file_read;
  struct CurlparseVirtualFileEntry *entries;
  size_t entry_count;
};

struct CurlparseVirtualFileError {
  const char *code;
  const char *path;
  const char *option;
};

void curlparse_virtual_files_init(struct CurlparseVirtualFiles *files);
void curlparse_virtual_files_free(struct CurlparseVirtualFiles *files);

int curlparse_virtual_files_set_policy(
  struct CurlparseVirtualFiles *files,
  bool load_default_curlrc,
  bool allow_host_file_read
);

int curlparse_virtual_files_add(
  struct CurlparseVirtualFiles *files,
  const char *path,
  const char *contents
);

const char *curlparse_virtual_files_find(
  const struct CurlparseVirtualFiles *files,
  const char *path
);

bool curlparse_virtual_files_should_load_default_curlrc(
  const struct CurlparseVirtualFiles *files
);

bool curlparse_virtual_files_allows_host_file_read(
  const struct CurlparseVirtualFiles *files
);

int curlparse_virtual_files_require(
  const struct CurlparseVirtualFiles *files,
  const char *path,
  const char *option,
  const char **out_contents,
  struct CurlparseVirtualFileError *out_error
);

#endif
