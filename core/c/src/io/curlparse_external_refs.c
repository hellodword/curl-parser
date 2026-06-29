#include "io/curlparse_external_refs.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static char *curlparse_strdup(const char *input)
{
  size_t size;
  char *copy;

  if(!input) {
    return NULL;
  }

  size = strlen(input) + 1U;
  copy = malloc(size);
  if(copy) {
    memcpy(copy, input, size);
  }
  return copy;
}

static void free_external_ref(struct CurlparseExternalRef *ref)
{
  if(!ref) {
    return;
  }

  free(ref->id);
  free(ref->kind);
  free(ref->access);
  free(ref->option);
  free(ref->value);
  memset(ref, 0, sizeof(*ref));
}

void curlparse_external_refs_init(struct CurlparseExternalRefs *refs)
{
  if(refs) {
    memset(refs, 0, sizeof(*refs));
  }
}

void curlparse_external_refs_free(struct CurlparseExternalRefs *refs)
{
  size_t i;

  if(!refs) {
    return;
  }

  for(i = 0; i < refs->count; ++i) {
    free_external_ref(&refs->items[i]);
  }
  free(refs->items);
  memset(refs, 0, sizeof(*refs));
}

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
)
{
  struct CurlparseExternalRef *grown;
  struct CurlparseExternalRef item;
  char id_buffer[32];

  if(!refs || !kind || !access) {
    return -1;
  }

  snprintf(id_buffer, sizeof(id_buffer), "external-%zu", refs->count);
  memset(&item, 0, sizeof(item));
  item.id = curlparse_strdup(id_buffer);
  item.kind = curlparse_strdup(kind);
  item.access = curlparse_strdup(access);
  item.option = option ? curlparse_strdup(option) : NULL;
  item.value = value ? curlparse_strdup(value) : NULL;
  item.argv_index = argv_index;
  item.has_argv_index = has_argv_index;
  if(!item.id || !item.kind || !item.access ||
     (option && !item.option) || (value && !item.value)) {
    free_external_ref(&item);
    return -1;
  }

  grown = realloc(refs->items, (refs->count + 1U) * sizeof(*grown));
  if(!grown) {
    free_external_ref(&item);
    return -1;
  }
  refs->items = grown;
  refs->items[refs->count++] = item;

  if(out_id && out_id_size) {
    snprintf(out_id, out_id_size, "%s", id_buffer);
  }
  return 0;
}

const struct CurlparseExternalRef *curlparse_external_refs_find(
  const struct CurlparseExternalRefs *refs,
  const char *option,
  const char *value,
  unsigned argv_index,
  bool has_argv_index
)
{
  size_t i;

  if(!refs) {
    return NULL;
  }

  for(i = 0; i < refs->count; ++i) {
    const struct CurlparseExternalRef *ref = &refs->items[i];
    bool option_matches =
      (!option && !ref->option) ||
      (option && ref->option && strcmp(option, ref->option) == 0);
    bool value_matches =
      (!value && !ref->value) ||
      (value && ref->value && strcmp(value, ref->value) == 0);
    bool source_matches = !has_argv_index ||
      (ref->has_argv_index && ref->argv_index == argv_index);

    if(option_matches && value_matches && source_matches) {
      return ref;
    }
  }

  return NULL;
}
