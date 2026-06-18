#include "io/curlparse_virtual_files.h"

#include <stdlib.h>
#include <string.h>

static char *curlparse_strdup(const char *input)
{
  size_t size;
  char *copy;

  if(!input) {
    return NULL;
  }

  size = strlen(input) + 1;
  copy = malloc(size);
  if(!copy) {
    return NULL;
  }

  memcpy(copy, input, size);
  return copy;
}

void curlparse_virtual_files_init(struct CurlparseVirtualFiles *files)
{
  if(!files) {
    return;
  }

  memset(files, 0, sizeof(*files));
}

void curlparse_virtual_files_free(struct CurlparseVirtualFiles *files)
{
  size_t i;

  if(!files) {
    return;
  }

  for(i = 0; i < files->entry_count; ++i) {
    free(files->entries[i].path);
    free(files->entries[i].contents);
  }

  free(files->entries);
  memset(files, 0, sizeof(*files));
}

int curlparse_virtual_files_set_policy(
  struct CurlparseVirtualFiles *files,
  bool load_default_curlrc,
  bool allow_host_file_read
)
{
  if(!files) {
    return -1;
  }

  files->load_default_curlrc = load_default_curlrc;
  files->allow_host_file_read = allow_host_file_read;
  return 0;
}

int curlparse_virtual_files_add(
  struct CurlparseVirtualFiles *files,
  const char *path,
  const char *contents
)
{
  struct CurlparseVirtualFileEntry *grown;
  char *path_copy;
  char *contents_copy;

  if(!files || !path || !contents) {
    return -1;
  }

  path_copy = curlparse_strdup(path);
  contents_copy = curlparse_strdup(contents);
  if(!path_copy || !contents_copy) {
    free(path_copy);
    free(contents_copy);
    return -1;
  }

  grown = realloc(files->entries, (files->entry_count + 1) * sizeof(*grown));
  if(!grown) {
    free(path_copy);
    free(contents_copy);
    return -1;
  }

  files->entries = grown;
  files->entries[files->entry_count].path = path_copy;
  files->entries[files->entry_count].contents = contents_copy;
  ++files->entry_count;
  return 0;
}

const char *curlparse_virtual_files_find(
  const struct CurlparseVirtualFiles *files,
  const char *path
)
{
  size_t i;

  if(!files || !path) {
    return NULL;
  }

  for(i = 0; i < files->entry_count; ++i) {
    if(strcmp(files->entries[i].path, path) == 0) {
      return files->entries[i].contents;
    }
  }

  return NULL;
}

bool curlparse_virtual_files_should_load_default_curlrc(
  const struct CurlparseVirtualFiles *files
)
{
  return files && files->load_default_curlrc;
}

bool curlparse_virtual_files_allows_host_file_read(
  const struct CurlparseVirtualFiles *files
)
{
  return files && files->allow_host_file_read;
}

int curlparse_virtual_files_require(
  const struct CurlparseVirtualFiles *files,
  const char *path,
  const char *option,
  const char **out_contents,
  struct CurlparseVirtualFileError *out_error
)
{
  const char *contents;

  if(!files || !path || !out_contents) {
    return -1;
  }

  contents = curlparse_virtual_files_find(files, path);
  if(contents) {
    *out_contents = contents;
    if(out_error) {
      memset(out_error, 0, sizeof(*out_error));
    }
    return 0;
  }

  *out_contents = NULL;
  if(out_error) {
    out_error->code = files->allow_host_file_read ?
      "host-file-read-required" : "virtual-file-not-provided";
    out_error->path = path;
    out_error->option = option;
  }
  return 1;
}
