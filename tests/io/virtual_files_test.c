#include "io/curlparse_virtual_files.h"

#include <assert.h>
#include <string.h>

int main(void)
{
  struct CurlparseVirtualFiles files;
  struct CurlparseVirtualFileError error;
  const char *contents = NULL;

  curlparse_virtual_files_init(&files);
  assert(curlparse_virtual_files_set_policy(&files, false, false) == 0);
  assert(curlparse_virtual_files_add(
           &files,
           "curl.conf",
           "url = \"https://example.com\"\nheader = \"A: B\"\n") == 0);
  assert(curlparse_virtual_files_add(&files, "-", "stdin content") == 0);

  assert(!curlparse_virtual_files_should_load_default_curlrc(&files));
  assert(!curlparse_virtual_files_allows_host_file_read(&files));

  assert(curlparse_virtual_files_require(&files, "curl.conf", "--config",
                                         &contents, &error) == 0);
  assert(contents != NULL);
  assert(strstr(contents, "https://example.com") != NULL);

  contents = NULL;
  assert(curlparse_virtual_files_require(&files, "-", "--config",
                                         &contents, &error) == 0);
  assert(contents != NULL);
  assert(strcmp(contents, "stdin content") == 0);

  contents = NULL;
  assert(curlparse_virtual_files_require(&files, "missing.conf", "--config",
                                         &contents, &error) == 1);
  assert(contents == NULL);
  assert(strcmp(error.code, "virtual-file-not-provided") == 0);
  assert(strcmp(error.path, "missing.conf") == 0);
  assert(strcmp(error.option, "--config") == 0);

  curlparse_virtual_files_free(&files);
  return 0;
}
