#include "curlparse/api.h"

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "api/curlparse_json.h"
#include "api/curlparse_result.h"
#include "capture/curlparse_event_scan.h"
#include "capture/curlparse_serialize_config.h"
#include "runtime/curlparse_libinfo.h"
#include "runtime/curlparse_option_guard.h"
#include "runtime/curlparse_stub_contract.h"
#include "tool_cfgable.h"
#include "tool_stderr.h"

#define CURLPARSE_ENGINE_MAGIC 0x43505233U
#define CURLPARSE_ERR_INVALID_INPUT -1
#define CURLPARSE_ERR_INPUT_JSON -2
#define CURLPARSE_ERR_PARSE -3
#define CURLPARSE_ERR_OUTPUT_PAIR -4
#define CURLPARSE_ERR_ENGINE -6
#define CURLPARSE_ERR_UNIMPLEMENTED -7

struct CurlparseEngine {
  uint32_t magic;
  uint32_t disposed;
  uint32_t parse_count;
  uint32_t runtime_profile_version;
  uint32_t option_catalog_version;
  uint32_t stub_contract_version;
  uint32_t diagnostic_table_version;
};

#ifndef CURLPARSE_WASM
#define CURLPARSE_HEAP_ALIGNMENT 8U
#define CURLPARSE_HEAP_INITIAL_SIZE 4096U
#define CURLPARSE_HEAP_RESERVED 8U

struct CurlparseHeap {
  unsigned char *data;
  uint32_t size;
  uint32_t used;
};

static struct CurlparseHeap g_heap;
#endif

#ifndef CURLPARSE_WASM
static uint32_t align_size(uint32_t size)
{
  return (size + (CURLPARSE_HEAP_ALIGNMENT - 1U)) &
         ~(CURLPARSE_HEAP_ALIGNMENT - 1U);
}

static int ensure_heap_capacity(uint32_t required)
{
  unsigned char *grown;
  uint32_t new_size = g_heap.size ? g_heap.size : CURLPARSE_HEAP_INITIAL_SIZE;

  if(required <= g_heap.size) {
    return 0;
  }

  while(new_size < required) {
    new_size *= 2U;
  }

  grown = realloc(g_heap.data, new_size);
  if(!grown) {
    return -1;
  }

  memset(grown + g_heap.size, 0, new_size - g_heap.size);
  g_heap.data = grown;
  g_heap.size = new_size;
  if(g_heap.used < CURLPARSE_HEAP_RESERVED) {
    g_heap.used = CURLPARSE_HEAP_RESERVED;
  }
  return 0;
}

static void reset_native_heap(void)
{
  if(g_heap.data && g_heap.size) {
    memset(g_heap.data, 0, g_heap.size);
  }
  g_heap.used = CURLPARSE_HEAP_RESERVED;
}
#endif

void *curlparse_native_ptr(uint32_t ptr, uint32_t size)
{
#ifdef CURLPARSE_WASM
  (void)size;
  if(ptr == 0U || size == 0U) {
    return NULL;
  }
  return (void *)(uintptr_t)ptr;
#else
  uint64_t end;

  if(ptr < CURLPARSE_HEAP_RESERVED || size == 0U || !g_heap.data) {
    return NULL;
  }

  end = (uint64_t)ptr + (uint64_t)size;
  if(end > g_heap.used) {
    return NULL;
  }

  return g_heap.data + ptr;
#endif
}

static void write_u32_le(unsigned char *target, uint32_t value)
{
  target[0] = (unsigned char)(value & 0xffU);
  target[1] = (unsigned char)((value >> 8) & 0xffU);
  target[2] = (unsigned char)((value >> 16) & 0xffU);
  target[3] = (unsigned char)((value >> 24) & 0xffU);
}

static uint32_t read_u32_le(const unsigned char *source)
{
  return (uint32_t)source[0] |
         ((uint32_t)source[1] << 8) |
         ((uint32_t)source[2] << 16) |
         ((uint32_t)source[3] << 24);
}

struct CurlparseArgvRewrite {
  size_t index;
  const char *previous;
  char *replacement;
};

struct CurlparseArgvRewriteList {
  struct CurlparseArgvRewrite *items;
  size_t count;
};

static void free_argv_rewrites(struct CurlparseArgvRewriteList *rewrites)
{
  size_t i;

  if(!rewrites) {
    return;
  }

  for(i = 0; i < rewrites->count; ++i) {
    free(rewrites->items[i].replacement);
  }
  free(rewrites->items);
  memset(rewrites, 0, sizeof(*rewrites));
}

static void restore_argv_rewrites(
  struct CurlparseInput *input,
  struct CurlparseArgvRewriteList *rewrites
)
{
  size_t i;

  if(!input || !rewrites) {
    return;
  }

  for(i = rewrites->count; i > 0U; --i) {
    const struct CurlparseArgvRewrite *rewrite = &rewrites->items[i - 1U];
    if(rewrite->index < input->argv_count) {
      input->argv[rewrite->index] = rewrite->previous;
    }
  }
}

static char *copy_string(const char *text)
{
  size_t size;
  char *copy;

  if(!text) {
    return NULL;
  }

  size = strlen(text) + 1U;
  copy = malloc(size);
  if(copy) {
    memcpy(copy, text, size);
  }
  return copy;
}

static char *make_long_option_inline(const char *flag, const char *value)
{
  size_t flag_len = flag ? strlen(flag) : 0U;
  size_t value_len = value ? strlen(value) : 0U;
  char *token = malloc(flag_len + 1U + value_len + 1U);

  if(!token || !flag) {
    free(token);
    return NULL;
  }

  memcpy(token, flag, flag_len);
  token[flag_len] = '=';
  if(value_len) {
    memcpy(token + flag_len + 1U, value, value_len);
  }
  token[flag_len + 1U + value_len] = '\0';
  return token;
}

static int add_argv_rewrite_owned(
  struct CurlparseInput *input,
  struct CurlparseArgvRewriteList *rewrites,
  size_t index,
  char *replacement
)
{
  struct CurlparseArgvRewrite *grown;

  if(!input || !rewrites || index >= input->argv_count || !replacement) {
    free(replacement);
    return -1;
  }

  grown = realloc(rewrites->items, (rewrites->count + 1U) * sizeof(*grown));
  if(!grown) {
    free(replacement);
    return -1;
  }

  rewrites->items = grown;
  rewrites->items[rewrites->count].index = index;
  rewrites->items[rewrites->count].previous = input->argv[index];
  rewrites->items[rewrites->count].replacement = replacement;
  input->argv[index] = replacement;
  ++rewrites->count;
  return 0;
}

static int add_argv_rewrite(
  struct CurlparseInput *input,
  struct CurlparseArgvRewriteList *rewrites,
  size_t index,
  const char *replacement
)
{
  return add_argv_rewrite_owned(input, rewrites, index,
                                copy_string(replacement ? replacement : ""));
}

static bool string_equal(const char *left, const char *right)
{
  return left && right && strcmp(left, right) == 0;
}

static bool event_is_canonical(
  const struct CurlparseOptionEvent *event,
  const char *canonical
)
{
  return event && string_equal(event->canonical, canonical);
}

static int rewrite_value_option_event(
  struct CurlparseInput *input,
  struct CurlparseArgvRewriteList *rewrites,
  const struct CurlparseOptionEvent *event,
  const char *flag,
  const char *replacement
)
{
  if(event->value_argv_index == event->argv_index) {
    return add_argv_rewrite_owned(input,
                                  rewrites,
                                  event->argv_index,
                                  make_long_option_inline(flag,
                                                          replacement));
  }

  if(add_argv_rewrite(input, rewrites, event->argv_index, flag) != 0) {
    return -1;
  }

  return add_argv_rewrite(input, rewrites, event->value_argv_index,
                          replacement ? replacement : "");
}

static int rewrite_noop_value_event(
  struct CurlparseInput *input,
  struct CurlparseArgvRewriteList *rewrites,
  const struct CurlparseOptionEvent *event
)
{
  return rewrite_value_option_event(input, rewrites, event, "--max-time", "0");
}

static const char *event_option_name(const struct CurlparseOptionEvent *event)
{
  return event && event->raw_flag ? event->raw_flag :
    (event ? event->canonical : NULL);
}

static bool canonical_in(
  const struct CurlparseOptionEvent *event,
  const char *const *names
)
{
  size_t i;

  if(!event || !event->canonical || !names) {
    return false;
  }

  for(i = 0; names[i]; ++i) {
    if(strcmp(event->canonical, names[i]) == 0) {
      return true;
    }
  }
  return false;
}

static char *copy_path_until_delim(const char *path)
{
  const char *end;
  size_t length;
  char *copy;

  if(!path) {
    return NULL;
  }

  end = path;
  while(*end && *end != ';' && *end != ',') {
    ++end;
  }
  length = (size_t)(end - path);
  copy = malloc(length + 1U);
  if(!copy) {
    return NULL;
  }
  memcpy(copy, path, length);
  copy[length] = '\0';
  return copy;
}

static char *data_urlencode_file_path(const char *value)
{
  const char *equal;
  const char *at;

  if(!value) {
    return NULL;
  }

  if(value[0] == '@' && value[1]) {
    return copy_path_until_delim(value + 1);
  }

  equal = strchr(value, '=');
  if(equal) {
    return NULL;
  }

  at = strchr(value, '@');
  if(!at || at == value || !at[1]) {
    return NULL;
  }
  return copy_path_until_delim(at + 1);
}

static char *form_first_file_path(const char *value)
{
  const char *equal;

  if(!value) {
    return NULL;
  }

  equal = strchr(value, '=');
  if(!equal || !equal[1]) {
    return NULL;
  }
  if(equal[1] == '@' || equal[1] == '<') {
    return copy_path_until_delim(equal + 2);
  }
  return NULL;
}

static char *form_headers_file_path(const char *value)
{
  const char *marker;

  if(!value) {
    return NULL;
  }

  marker = strstr(value, "headers=@");
  if(!marker) {
    return NULL;
  }

  return copy_path_until_delim(marker + strlen("headers=@"));
}

static bool cookie_value_is_file(const char *value)
{
  return value && value[0] && strchr(value, '=') == NULL;
}

static const char *external_kind_for_path(const char *path)
{
  if(path && strcmp(path, "-") == 0) {
    return "stdin";
  }
  if(path && strcmp(path, ".") == 0) {
    return "directory";
  }
  return "file";
}

static int add_path_ref(
  struct CurlparseInput *input,
  const struct CurlparseOptionEvent *event,
  const char *path,
  const char *access
)
{
  if(!input || !event || !path) {
    return -1;
  }

  return curlparse_external_refs_add(&input->external_refs,
                                     external_kind_for_path(path),
                                     access ? access : "read",
                                     event_option_name(event),
                                     path,
                                     event->has_value ?
                                       event->value_argv_index :
                                       event->argv_index,
                                     true,
                                     NULL,
                                     0U);
}

static int add_value_ref(
  struct CurlparseInput *input,
  const struct CurlparseOptionEvent *event,
  const char *kind,
  const char *access,
  const char *value
)
{
  if(!input || !event || !kind || !access) {
    return -1;
  }

  return curlparse_external_refs_add(&input->external_refs,
                                     kind,
                                     access,
                                     event_option_name(event),
                                     value,
                                     event->has_value ?
                                       event->value_argv_index :
                                       event->argv_index,
                                     true,
                                     NULL,
                                     0U);
}

static bool time_cond_value_looks_like_file(const char *value)
{
  if(!value || !value[0]) {
    return false;
  }
  if(strchr(value, '/') || strchr(value, '\\')) {
    return true;
  }
  if(strchr(value, '.') && !strchr(value, ' ') && !strchr(value, ',')) {
    return true;
  }
  return false;
}

static int add_report_error(
  struct CurlparseGuardReport *report,
  const char *code,
  const char *option,
  const char *detail
)
{
  struct CurlparseGuardMessage *grown;

  if(!report || !code) {
    return -1;
  }

  grown = realloc(report->errors,
                  (report->error_count + 1U) * sizeof(*grown));
  if(!grown) {
    return -1;
  }
  report->errors = grown;
  report->errors[report->error_count].code = code;
  report->errors[report->error_count].option =
    option ? copy_string(option) : NULL;
  report->errors[report->error_count].detail =
    detail ? copy_string(detail) : NULL;
  report->errors[report->error_count].warning = false;
  if((option && !report->errors[report->error_count].option) ||
     (detail && !report->errors[report->error_count].detail)) {
    free(report->errors[report->error_count].option);
    free(report->errors[report->error_count].detail);
    return -1;
  }

  ++report->error_count;
  report->ok = false;
  return 0;
}

static bool event_is_expand_option(const struct CurlparseOptionEvent *event)
{
  const char *raw = event ? event->raw_flag : NULL;
  return raw && strncmp(raw, "--expand-", 9U) == 0;
}

static bool event_is_rejected_parse_host_option(
  const struct CurlparseOptionEvent *event,
  const char **code,
  const char **detail
)
{
  static const char *const rejected[] = {
    "config",
    "variable",
    "libcurl",
    "dump-ca-embed",
    "manual",
    "help",
    "version",
    "metalink",
    NULL
  };

  if(!event) {
    return false;
  }

  if(event_is_expand_option(event)) {
    *code = "E_HOST_VARIABLE_EXPANSION_UNSUPPORTED";
    *detail = "curl variable expansion can read host files or environment";
    return true;
  }

  if(canonical_in(event, rejected)) {
    *code = "E_PARSE_HOST_DEPENDENCY_UNSUPPORTED";
    *detail = "option requires host-dependent curl CLI behavior";
    return true;
  }

  if(event_is_canonical(event, "url") &&
     event->value && event->value[0] == '@') {
    *code = "E_HOST_URL_FILE_UNSUPPORTED";
    *detail = "--url @file changes the request set and is not parsed";
    return true;
  }

  if(event_is_canonical(event, "time-cond") &&
     time_cond_value_looks_like_file(event->value)) {
    *code = "E_HOST_FILE_MTIME_UNSUPPORTED";
    *detail = "--time-cond file mtime lookup is not parsed";
    return true;
  }

  return false;
}

static int rewrite_external_form_event(
  struct CurlparseInput *input,
  struct CurlparseArgvRewriteList *rewrites,
  const struct CurlparseOptionEvent *event
)
{
  const char *value = event && event->value ? event->value : "";
  const char *equal = strchr(value, '=');
  char *replacement;
  size_t name_len;

  if(!input || !rewrites || !event) {
    return -1;
  }

  name_len = equal && equal > value ? (size_t)(equal - value) : 5U;
  replacement = malloc(name_len + 2U);
  if(!replacement) {
    return -1;
  }
  if(equal && equal > value) {
    memcpy(replacement, value, name_len);
  }
  else {
    memcpy(replacement, "field", 5U);
  }
  replacement[name_len] = '=';
  replacement[name_len + 1U] = '\0';

  {
    int rc = rewrite_value_option_event(input, rewrites, event, "--form",
                                        replacement);
    free(replacement);
    return rc;
  }
}

static int collect_external_refs_and_rewrite_argv(
  struct CurlparseInput *input,
  const struct CurlparseEventScan *scan,
  struct CurlparseArgvRewriteList *rewrites,
  struct CurlparseGuardReport *preflight
)
{
  static const char *const existingfile_options[] = {
    "cacert", "crlfile", "knownhosts", "netrc-file",
    "proxy-cacert", "proxy-crlfile", NULL
  };
  static const char *const security_file_options[] = {
    "cert", "key", "pubkey", "pinnedpubkey", "proxy-cert", "proxy-key",
    "proxy-pinnedpubkey", "random-file", "egd-file", NULL
  };
  static const char *const security_dir_options[] = {
    "capath", "proxy-capath", NULL
  };
  static const char *const output_file_options[] = {
    "output", "dump-header", "cookie-jar", "etag-save", "alt-svc", "hsts",
    "stderr", "trace", "trace-ascii", NULL
  };
  static const char *const capability_value_options[] = {
    "unix-socket", "abstract-unix-socket", "interface", "dns-interface",
    "local-port", "ftp-port", "ipfs-gateway", NULL
  };
  size_t i;

  if(!input || !scan || !rewrites || !preflight) {
    return -1;
  }

  memset(rewrites, 0, sizeof(*rewrites));
  for(i = 0; i < scan->event_count; ++i) {
    const struct CurlparseOptionEvent *event = &scan->events[i];
    const char *code = NULL;
    const char *detail = NULL;
    int rc = 0;

    if(event->is_positional && event->value &&
       strncmp(event->value, "file://", 7U) == 0) {
      if(curlparse_external_refs_add(&input->external_refs,
                                     "local-file-url",
                                     "read",
                                     NULL,
                                     event->value,
                                     event->argv_index,
                                     true,
                                     NULL,
                                     0U) != 0) {
        return -1;
      }
      continue;
    }

    if(event_is_rejected_parse_host_option(event, &code, &detail)) {
      if(add_report_error(preflight, code, event_option_name(event), detail) != 0) {
        return -1;
      }
      continue;
    }

    if(!event->canonical) {
      continue;
    }

    if((event_is_canonical(event, "data") ||
        event_is_canonical(event, "data-binary") ||
        event_is_canonical(event, "json")) &&
       event->value && event->value[0] == '@' && event->value[1]) {
      const char *path = event->value + 1;
      if(add_path_ref(input, event, path, "read") != 0) {
        return -1;
      }
      if(event_is_canonical(event, "json")) {
        rc = rewrite_value_option_event(input, rewrites, event, "--json", "{}");
      }
      else {
        rc = rewrite_value_option_event(input, rewrites, event,
                                        "--data-raw", "");
      }
    }
    else if((event_is_canonical(event, "data-urlencode") ||
             event_is_canonical(event, "url-query")) &&
            event->value) {
      char *path = data_urlencode_file_path(event->value);
      if(path) {
        rc = add_path_ref(input, event, path, "read");
        free(path);
        if(rc != 0) {
          return -1;
        }
        rc = rewrite_value_option_event(input, rewrites, event,
                                        event_is_canonical(event, "url-query") ?
                                          "--url-query" : "--data-urlencode",
                                        event_is_canonical(event, "url-query") ?
                                          "+" : "");
      }
    }
    else if((event_is_canonical(event, "header") ||
             event_is_canonical(event, "proxy-header")) &&
            event->value && event->value[0] == '@' && event->value[1]) {
      if(add_path_ref(input, event, event->value + 1, "read") != 0) {
        return -1;
      }
      rc = rewrite_value_option_event(input, rewrites, event,
                                      event_is_canonical(event, "proxy-header") ?
                                        "--proxy-header" : "--header",
                                      "X-Curl-Parser-External-Header:");
    }
    else if(event_is_canonical(event, "form") && event->value) {
      char *path = form_first_file_path(event->value);
      char *headers = form_headers_file_path(event->value);
      if(path) {
        rc = add_path_ref(input, event, path, "read");
        free(path);
        if(rc != 0) {
          free(headers);
          return -1;
        }
      }
      if(headers) {
        rc = add_path_ref(input, event, headers, "read");
        free(headers);
        if(rc != 0) {
          return -1;
        }
      }
      if(path || headers) {
        rc = rewrite_external_form_event(input, rewrites, event);
      }
    }
    else if(event_is_canonical(event, "upload-file") &&
            event->value && event->value[0]) {
      rc = add_path_ref(input, event, event->value, "read");
    }
    else if(event_is_canonical(event, "cookie") &&
            cookie_value_is_file(event->value)) {
      rc = add_path_ref(input, event, event->value, "read");
    }
    else if(event_is_canonical(event, "etag-compare") &&
            event->value && event->value[0]) {
      rc = add_path_ref(input, event, event->value, "read");
    }
    else if(event_is_canonical(event, "write-out") &&
            event->value && event->value[0] == '@' && event->value[1]) {
      rc = add_path_ref(input, event, event->value + 1, "read");
      if(rc == 0) {
        rc = rewrite_value_option_event(input, rewrites, event,
                                        "--write-out", "");
      }
    }
    else if(canonical_in(event, existingfile_options) &&
            event->value && event->value[0]) {
      const char *kind = event_is_canonical(event, "netrc-file") ?
        "netrc" : "file";
      rc = add_value_ref(input, event, kind, "read", event->value);
      if(rc == 0) {
        rc = rewrite_noop_value_event(input, rewrites, event);
      }
    }
    else if(canonical_in(event, security_file_options) &&
            event->value && event->value[0]) {
      rc = add_value_ref(input, event, "file", "read", event->value);
    }
    else if(canonical_in(event, security_dir_options) &&
            event->value && event->value[0]) {
      rc = add_value_ref(input, event, "directory", "read", event->value);
    }
    else if(event_is_canonical(event, "netrc") ||
            event_is_canonical(event, "netrc-optional")) {
      if(!event->negated) {
        rc = add_value_ref(input, event, "netrc", "read", NULL);
      }
    }
    else if(canonical_in(event, output_file_options) &&
            event->value && event->value[0]) {
      const char *kind = event_is_canonical(event, "cookie-jar") ?
        "cookie-jar" : "output-file";
      const char *access = event_is_canonical(event, "cookie-jar") ?
        "read-write" : "write";
      rc = add_value_ref(input, event, kind, access, event->value);
    }
    else if(event_is_canonical(event, "output-dir") &&
            event->value && event->value[0]) {
      rc = add_value_ref(input, event, "directory", "write", event->value);
    }
    else if(event_is_canonical(event, "ssl-sessions") &&
            event->value && event->value[0]) {
      rc = add_value_ref(input, event, "file", "read-write", event->value);
    }
    else if(canonical_in(event, capability_value_options) &&
            event->value && event->value[0]) {
      const char *kind =
        (event_is_canonical(event, "unix-socket") ||
         event_is_canonical(event, "abstract-unix-socket")) ?
        "unix-socket" :
        (event_is_canonical(event, "interface") ||
         event_is_canonical(event, "dns-interface") ||
         event_is_canonical(event, "local-port") ||
         event_is_canonical(event, "ftp-port")) ?
        "network-interface" : "file";
      const char *access = strcmp(kind, "unix-socket") == 0 ?
        "connect" : "use";
      rc = add_value_ref(input, event, kind, access, event->value);
    }
    else if(event_is_canonical(event, "ca-native") ||
            event_is_canonical(event, "proxy-ca-native")) {
      if(!event->negated) {
        rc = add_value_ref(input, event, "os-trust-store", "read", NULL);
      }
    }
    else if(event_is_canonical(event, "ssl-auto-client-cert") ||
            event_is_canonical(event, "proxy-ssl-auto-client-cert")) {
      if(!event->negated) {
        rc = add_value_ref(input, event, "os-client-cert-store",
                           "read", NULL);
      }
    }

    if(rc != 0) {
      return -1;
    }
  }

  return 0;
}

static int32_t write_output_json_to_pair(
  const char *output_json,
  size_t output_len,
  unsigned char *out_pair
)
{
  uint32_t output_ptr;
  void *output_memory;

  if(!output_json || !out_pair || output_len > UINT32_MAX) {
    return CURLPARSE_ERR_PARSE;
  }

  output_ptr = curlparse_alloc((uint32_t)output_len);
  if(!output_ptr) {
    return CURLPARSE_ERR_PARSE;
  }

  output_memory = curlparse_native_ptr(output_ptr, (uint32_t)output_len);
  if(!output_memory) {
    return CURLPARSE_ERR_PARSE;
  }

  memcpy(output_memory, output_json, output_len);
  write_u32_le(out_pair, output_ptr);
  write_u32_le(out_pair + 4, (uint32_t)output_len);
  return 0;
}

struct CurlparseJsonBuffer {
  char *data;
  size_t len;
  size_t cap;
};

struct CurlparsePlanIssue {
  const char *behavior;
  const char *level;
  const char *message;
  bool diagnostic;
};

struct CurlparsePlanState {
  struct CurlparsePlanIssue issues[16];
  size_t issue_count;
  bool has_lossy;
  bool has_runtime_helper;
  bool has_unsupported;
};

static int json_buffer_reserve(struct CurlparseJsonBuffer *buffer, size_t needed)
{
  char *grown;
  size_t new_cap;

  if(!buffer) {
    return -1;
  }
  if(needed <= buffer->cap) {
    return 0;
  }

  new_cap = buffer->cap ? buffer->cap : 1024U;
  while(new_cap < needed) {
    if(new_cap > (SIZE_MAX / 2U)) {
      return -1;
    }
    new_cap *= 2U;
  }

  grown = realloc(buffer->data, new_cap);
  if(!grown) {
    return -1;
  }
  buffer->data = grown;
  buffer->cap = new_cap;
  return 0;
}

static int json_buffer_append(
  struct CurlparseJsonBuffer *buffer,
  const char *text
)
{
  size_t len;

  if(!buffer || !text) {
    return -1;
  }

  len = strlen(text);
  if(json_buffer_reserve(buffer, buffer->len + len + 1U) != 0) {
    return -1;
  }
  memcpy(buffer->data + buffer->len, text, len);
  buffer->len += len;
  buffer->data[buffer->len] = '\0';
  return 0;
}

static int json_buffer_appendf(
  struct CurlparseJsonBuffer *buffer,
  const char *format,
  ...
)
{
  va_list args;
  va_list args_copy;
  int needed;

  if(!buffer || !format) {
    return -1;
  }

  va_start(args, format);
  va_copy(args_copy, args);
  needed = vsnprintf(NULL, 0, format, args);
  va_end(args);
  if(needed < 0) {
    va_end(args_copy);
    return -1;
  }

  if(json_buffer_reserve(buffer, buffer->len + (size_t)needed + 1U) != 0) {
    va_end(args_copy);
    return -1;
  }
  if(vsnprintf(buffer->data + buffer->len,
               buffer->cap - buffer->len,
               format,
               args_copy) != needed) {
    va_end(args_copy);
    return -1;
  }
  va_end(args_copy);
  buffer->len += (size_t)needed;
  return 0;
}

static const char *skip_json_ws(const char *cursor)
{
  while(cursor &&
        (*cursor == ' ' || *cursor == '\n' ||
         *cursor == '\r' || *cursor == '\t')) {
    ++cursor;
  }
  return cursor;
}

static int extract_json_string_field(
  const char *json,
  const char *field,
  char *out,
  size_t out_size
)
{
  char pattern[64];
  const char *cursor;
  size_t field_len;
  size_t copied = 0U;

  if(!json || !field || !out || out_size == 0U) {
    return -1;
  }

  field_len = strlen(field);
  if(field_len + 3U > sizeof(pattern)) {
    return -1;
  }
  pattern[0] = '"';
  memcpy(pattern + 1U, field, field_len);
  pattern[field_len + 1U] = '"';
  pattern[field_len + 2U] = '\0';

  cursor = strstr(json, pattern);
  if(!cursor) {
    return -1;
  }
  cursor += field_len + 2U;
  cursor = skip_json_ws(cursor);
  if(!cursor || *cursor != ':') {
    return -1;
  }
  cursor = skip_json_ws(cursor + 1U);
  if(!cursor || *cursor != '"') {
    return -1;
  }
  ++cursor;

  while(*cursor && *cursor != '"') {
    if(*cursor == '\\' || copied + 1U >= out_size) {
      return -1;
    }
    out[copied++] = *cursor++;
  }
  if(*cursor != '"') {
    return -1;
  }
  out[copied] = '\0';
  return 0;
}

static bool planner_target_is_known(const char *target)
{
  return target &&
    (strcmp(target, "c.libcurl") == 0 ||
     strcmp(target, "python.requests") == 0 ||
     strcmp(target, "js.fetch") == 0 ||
     strcmp(target, "js.undici") == 0 ||
     strcmp(target, "go.net_http") == 0 ||
     strcmp(target, "rust.reqwest") == 0);
}

static bool planner_target_supports_http3(const char *target)
{
  return target && strcmp(target, "c.libcurl") == 0;
}

static const char *planner_proxy_capability(const char *target)
{
  if(target && strcmp(target, "js.fetch") == 0) {
    return "unsupported";
  }
  if(target && strcmp(target, "js.undici") == 0) {
    return "requires-runtime-helper";
  }
  return "native";
}

static const char *planner_tls_verify_capability(const char *target)
{
  if(target && strcmp(target, "js.fetch") == 0) {
    return "unsupported";
  }
  return "native";
}

static const char *planner_timeout_capability(const char *target)
{
  if(target && strcmp(target, "js.fetch") == 0) {
    return "requires-runtime-helper";
  }
  return "native";
}

static void record_plan_issue(
  struct CurlparsePlanState *state,
  const char *behavior,
  const char *level,
  const char *message,
  bool diagnostic
)
{
  if(!state || !behavior || !level || strcmp(level, "native") == 0) {
    return;
  }

  if(strcmp(level, "lossy") == 0) {
    state->has_lossy = true;
  }
  else if(strcmp(level, "requires-runtime-helper") == 0) {
    state->has_runtime_helper = true;
  }
  else if(strcmp(level, "unsupported") == 0) {
    state->has_unsupported = true;
  }
  if(state->issue_count < (sizeof(state->issues) / sizeof(state->issues[0]))) {
    state->issues[state->issue_count].behavior = behavior;
    state->issues[state->issue_count].level = level;
    state->issues[state->issue_count].message = message ? message : "";
    state->issues[state->issue_count].diagnostic = diagnostic;
    ++state->issue_count;
  }
}

static int append_plan_step(
  struct CurlparseJsonBuffer *buffer,
  struct CurlparsePlanState *state,
  bool *first_step,
  const char *behavior,
  const char *capability,
  const char *message
)
{
  if(!buffer || !first_step || !behavior || !capability) {
    return -1;
  }

  if(!*first_step && json_buffer_append(buffer, ",") != 0) {
    return -1;
  }
  *first_step = false;

  if(message && *message) {
    if(json_buffer_appendf(buffer,
                           "{\"behavior\":\"%s\",\"capability\":\"%s\","
                           "\"message\":\"%s\"}",
                           behavior,
                           capability,
                           message) != 0) {
      return -1;
    }
  }
  else if(json_buffer_appendf(buffer,
                              "{\"behavior\":\"%s\",\"capability\":\"%s\"}",
                              behavior,
                              capability) != 0) {
    return -1;
  }

  record_plan_issue(state,
                    behavior,
                    capability,
                    message,
                    strcmp(capability, "unsupported") == 0);
  return 0;
}

static const char *planner_support_level(
  const struct CurlparsePlanState *state
)
{
  if(state->has_unsupported) {
    return "unsupported";
  }
  if(state->has_runtime_helper) {
    return "requires-runtime-helper";
  }
  if(state->has_lossy) {
    return "lossy";
  }
  return "exact";
}

static int render_generate_request_plan(
  const char *input_json,
  const char *target,
  char **out_json,
  size_t *out_len
)
{
  struct CurlparseJsonBuffer buffer;
  struct CurlparsePlanState state;
  bool first_step = true;
  bool has_http2;
  bool has_http3;
  bool has_body;
  bool has_proxy;
  bool has_tls_verify_false;
  bool has_redirects;
  bool has_timeouts;
  bool has_external_refs;
  bool has_filesystem_refs;
  bool has_auth;
  bool has_cookies;
  size_t i;

  if(!input_json || !target || !out_json || !out_len) {
    return -1;
  }

  memset(&buffer, 0, sizeof(buffer));
  memset(&state, 0, sizeof(state));
  *out_json = NULL;
  *out_len = 0;

  has_http2 = strstr(input_json, "\"httpVersion\":\"2\"") != NULL;
  has_http3 = strstr(input_json, "\"httpVersion\":\"3\"") != NULL;
  has_body = strstr(input_json, "\"body\":{\"kind\"") != NULL;
  has_proxy = strstr(input_json, "\"proxy\":{\"url\"") != NULL;
  has_tls_verify_false = strstr(input_json, "\"tls\":{\"verify\":false") != NULL;
  has_redirects = strstr(input_json, "\"redirects\":{\"follow\":true") != NULL ||
                  strstr(input_json, "\"redirects\":{\"max\"") != NULL;
  has_timeouts = strstr(input_json, "\"timeouts\":{") != NULL;
  has_external_refs = strstr(input_json, "\"externalRefs\":[{") != NULL;
  has_filesystem_refs =
    strstr(input_json, "\"kind\":\"file\"") != NULL ||
    strstr(input_json, "\"kind\":\"stdin\"") != NULL ||
    strstr(input_json, "\"kind\":\"directory\"") != NULL ||
    strstr(input_json, "\"kind\":\"output-file\"") != NULL ||
    strstr(input_json, "\"kind\":\"cookie-jar\"") != NULL ||
    strstr(input_json, "\"kind\":\"local-file-url\"") != NULL;
  has_auth = strstr(input_json, "\"auth\":{\"scheme\"") != NULL;
  has_cookies = strstr(input_json, "\"cookies\":[{") != NULL;

  if(json_buffer_appendf(&buffer,
                         "{\"schemaVersion\":\"curl-generate-output/v1\","
                         "\"target\":\"%s\","
                         "\"files\":[],"
                         "\"plan\":{\"target\":\"%s\",\"transfers\":["
                         "{\"id\":\"transfer-0\",\"steps\":[",
                         target,
                         target) != 0) {
    free(buffer.data);
    return -1;
  }

  if(append_plan_step(&buffer, &state, &first_step,
                      "url", "native", NULL) != 0 ||
     append_plan_step(&buffer, &state, &first_step,
                      "method", "native", NULL) != 0 ||
     append_plan_step(&buffer, &state, &first_step,
                      "headers", "native", NULL) != 0) {
    free(buffer.data);
    return -1;
  }

  if(has_body &&
     append_plan_step(&buffer, &state, &first_step,
                      "body.raw", "native", NULL) != 0) {
    free(buffer.data);
    return -1;
  }
  if(has_auth &&
     append_plan_step(&buffer, &state, &first_step,
                      "auth.basic", "native", NULL) != 0) {
    free(buffer.data);
    return -1;
  }
  if(has_cookies &&
     append_plan_step(&buffer, &state, &first_step,
                      "cookies.inline", "native", NULL) != 0) {
    free(buffer.data);
    return -1;
  }
  if(has_proxy) {
    const char *capability = planner_proxy_capability(target);
    const char *message =
      strcmp(capability, "native") == 0 ? NULL :
      (strcmp(capability, "unsupported") == 0 ?
       "Target cannot preserve curl-style proxy selection" :
       "Target requires runtime proxy helper wiring");
    if(append_plan_step(&buffer, &state, &first_step,
                        "proxy", capability, message) != 0) {
      free(buffer.data);
      return -1;
    }
  }
  if(has_tls_verify_false) {
    const char *capability = planner_tls_verify_capability(target);
    const char *message =
      strcmp(capability, "native") == 0 ? NULL :
      "Target cannot disable TLS verification per request";
    if(append_plan_step(&buffer, &state, &first_step,
                        "tls.verify", capability, message) != 0) {
      free(buffer.data);
      return -1;
    }
  }
  if(has_redirects) {
    const char *capability =
      (target && strcmp(target, "js.fetch") == 0) ? "lossy" : "native";
    const char *message =
      strcmp(capability, "native") == 0 ? NULL :
      "Target cannot preserve curl's complete redirect policy";
    if(append_plan_step(&buffer, &state, &first_step,
                        "redirects", capability, message) != 0) {
      free(buffer.data);
      return -1;
    }
  }
  if(has_timeouts) {
    const char *capability = planner_timeout_capability(target);
    const char *message =
      strcmp(capability, "native") == 0 ? NULL :
      "Target requires runtime timeout helper wiring";
    if(append_plan_step(&buffer, &state, &first_step,
                        "timeout", capability, message) != 0) {
      free(buffer.data);
      return -1;
    }
  }
  if(has_http2) {
    const char *capability = "unsupported";
    const char *message = "Target cannot preserve HTTP/2 selection";
    if(target &&
       (strcmp(target, "c.libcurl") == 0 ||
        strcmp(target, "go.net_http") == 0 ||
        strcmp(target, "rust.reqwest") == 0)) {
      capability = "native";
      message = NULL;
    }
    else if(target && strcmp(target, "python.requests") == 0) {
      capability = "lossy";
      message = "Target cannot force HTTP/2; requests will use transport defaults";
    }
    if(append_plan_step(&buffer, &state, &first_step,
                        "http.version.2", capability, message) != 0) {
      free(buffer.data);
      return -1;
    }
  }
  if(has_http3) {
    const char *capability =
      planner_target_supports_http3(target) ? "native" : "unsupported";
    const char *message =
      strcmp(capability, "native") == 0 ? NULL :
      "Target cannot preserve HTTP/3 selection";
    if(append_plan_step(&buffer, &state, &first_step,
                        "http.version.3", capability, message) != 0) {
      free(buffer.data);
      return -1;
    }
  }
  if(has_external_refs) {
    const char *capability =
      (target && strcmp(target, "js.fetch") == 0 && has_filesystem_refs) ?
      "unsupported" : "requires-runtime-helper";
    const char *message =
      strcmp(capability, "unsupported") == 0 ?
      "Browser fetch cannot access local filesystem references" :
      "Generated code must provide runtime handling for external references";
    if(append_plan_step(&buffer, &state, &first_step,
                        "external-ref", capability, message) != 0) {
      free(buffer.data);
      return -1;
    }
  }

  if(json_buffer_append(&buffer, "]}]},\"support\":{\"level\":\"") != 0 ||
     json_buffer_append(&buffer, planner_support_level(&state)) != 0 ||
     json_buffer_append(&buffer, "\",\"items\":[") != 0) {
    free(buffer.data);
    return -1;
  }

  for(i = 0U; i < state.issue_count; ++i) {
    if(i > 0U && json_buffer_append(&buffer, ",") != 0) {
      free(buffer.data);
      return -1;
    }
    if(json_buffer_appendf(&buffer,
                           "{\"behavior\":\"%s\",\"level\":\"%s\","
                           "\"message\":\"%s\"}",
                           state.issues[i].behavior,
                           state.issues[i].level,
                           state.issues[i].message) != 0) {
      free(buffer.data);
      return -1;
    }
  }

  if(json_buffer_append(&buffer, "]},\"diagnostics\":[") != 0) {
    free(buffer.data);
    return -1;
  }

  {
    bool first_diagnostic = true;
    for(i = 0U; i < state.issue_count; ++i) {
      if(!state.issues[i].diagnostic) {
        continue;
      }
      if(!first_diagnostic && json_buffer_append(&buffer, ",") != 0) {
        free(buffer.data);
        return -1;
      }
      first_diagnostic = false;
      if(json_buffer_appendf(&buffer,
                             "{\"code\":\"%s\","
                             "\"severity\":\"error\","
                             "\"category\":\"target\","
                             "\"message\":\"%s\","
                             "\"details\":{\"target\":\"%s\","
                             "\"behavior\":\"%s\"}}",
                             "E_TARGET_UNSUPPORTED",
                             state.issues[i].message,
                             target,
                             state.issues[i].behavior) != 0) {
        free(buffer.data);
        return -1;
      }
    }
  }

  if(json_buffer_append(&buffer, "]}") != 0) {
    free(buffer.data);
    return -1;
  }

  *out_json = buffer.data;
  *out_len = buffer.len;
  return 0;
}

uint32_t curlparse_abi_version(void)
{
  return 1U;
}

uint32_t curlparse_alloc(uint32_t size)
{
#ifdef CURLPARSE_WASM
  void *ptr;

  if(size == 0U) {
    return 0U;
  }

  ptr = malloc(size);
  if(!ptr) {
    return 0U;
  }

  memset(ptr, 0, size);
  return (uint32_t)(uintptr_t)ptr;
#else
  uint32_t offset;
  uint32_t aligned_size;
  uint32_t required;

  if(size == 0U) {
    return 0U;
  }

  aligned_size = align_size(size);
  if(g_heap.used < CURLPARSE_HEAP_RESERVED) {
    g_heap.used = CURLPARSE_HEAP_RESERVED;
  }

  if(aligned_size > UINT32_MAX - g_heap.used) {
    return 0U;
  }

  offset = g_heap.used;
  required = g_heap.used + aligned_size;
  if(ensure_heap_capacity(required) != 0) {
    return 0U;
  }

  g_heap.used = required;
  return offset;
#endif
}

void curlparse_free(uint32_t ptr, uint32_t size)
{
  void *target = curlparse_native_ptr(ptr, size);

  if(target && size) {
    memset(target, 0, size);
#ifdef CURLPARSE_WASM
    free(target);
#endif
  }
}

void curlparse_buf_free(uint32_t ptr, uint32_t size)
{
  curlparse_free(ptr, size);
}

static struct CurlparseEngine *engine_from_handle(uint32_t engine)
{
  struct CurlparseEngine *state;

  state = curlparse_native_ptr(engine, (uint32_t)sizeof(*state));
  if(!state || state->magic != CURLPARSE_ENGINE_MAGIC) {
    return NULL;
  }

  return state;
}

uint32_t curlparse_engine_new(void)
{
  uint32_t handle;
  struct CurlparseEngine *state;

  handle = curlparse_alloc((uint32_t)sizeof(*state));
  if(!handle) {
    return 0U;
  }

  state = curlparse_native_ptr(handle, (uint32_t)sizeof(*state));
  if(!state) {
    return 0U;
  }

  state->magic = CURLPARSE_ENGINE_MAGIC;
  state->disposed = 0U;
  state->parse_count = 0U;
  state->runtime_profile_version = 1U;
  state->option_catalog_version = 1U;
  state->stub_contract_version = 1U;
  state->diagnostic_table_version = 1U;
  return handle;
}

void curlparse_engine_free(uint32_t engine)
{
  struct CurlparseEngine *state = engine_from_handle(engine);

  if(state) {
    state->disposed = 1U;
  }
}

static int32_t curlparse_parse_impl(
  uint32_t input_ptr,
  uint32_t input_len,
  uint32_t out_pair_ptr
)
{
  const char *input_json;
  unsigned char *out_pair;
  struct CurlparseInput input;
  struct CurlparseJsonError input_error;
  struct CurlparseEventScan scan;
  struct CurlparseGuardReport report;
  struct CurlparseGuardReport preflight_report;
  struct CurlparseArgvRewriteList rewrites;
  char *output_json = NULL;
  char *operations_json = NULL;
  size_t output_len = 0;
  CURLcode init_rc;
  ParameterError parse_error = PARAM_OK;
  bool global_initialized = false;

  input_json = curlparse_native_ptr(input_ptr, input_len);
  if(!input_json) {
    return CURLPARSE_ERR_INVALID_INPUT;
  }

  out_pair = curlparse_native_ptr(out_pair_ptr, 8U);
  if(!out_pair) {
    return CURLPARSE_ERR_OUTPUT_PAIR;
  }

  memset(&scan, 0, sizeof(scan));
  memset(&report, 0, sizeof(report));
  memset(&preflight_report, 0, sizeof(preflight_report));
  memset(&rewrites, 0, sizeof(rewrites));
  preflight_report.ok = true;

  if(curlparse_json_parse_input_ex(input_json, input_len, &input,
                                   &input_error) != 0) {
    int32_t write_rc;
    if(curlparse_render_input_error_result(&input_error,
                                           &output_json,
                                           &output_len) != 0) {
      return CURLPARSE_ERR_INPUT_JSON;
    }
    write_rc = write_output_json_to_pair(output_json, output_len, out_pair);
    free(output_json);
    return write_rc;
  }

  if(curlparse_scan_events(input.argv, input.argv_count, &scan) != 0) {
    curlparse_json_free_input(&input);
    return CURLPARSE_ERR_PARSE;
  }

  curlparse_apply_libinfo_profile(&input.runtime_profile);

  if(collect_external_refs_and_rewrite_argv(&input,
                                            &scan,
                                            &rewrites,
                                            &preflight_report) != 0) {
    restore_argv_rewrites(&input, &rewrites);
    free_argv_rewrites(&rewrites);
    curlparse_event_scan_free(&scan);
    curlparse_json_free_input(&input);
    return CURLPARSE_ERR_PARSE;
  }

  if(preflight_report.error_count) {
    restore_argv_rewrites(&input, &rewrites);
    if(curlparse_apply_option_guards(&input.runtime_profile,
                                     &scan,
                                     input.parse_mode,
                                     &report) != 0) {
      free_argv_rewrites(&rewrites);
      curlparse_guard_report_free(&preflight_report);
      curlparse_event_scan_free(&scan);
      curlparse_json_free_input(&input);
      return CURLPARSE_ERR_PARSE;
    }
    for(size_t i = 0; i < preflight_report.error_count; ++i) {
      if(add_report_error(&report,
                          preflight_report.errors[i].code,
                          preflight_report.errors[i].option,
                          preflight_report.errors[i].detail) != 0) {
        free_argv_rewrites(&rewrites);
        curlparse_guard_report_free(&preflight_report);
        curlparse_guard_report_free(&report);
        curlparse_event_scan_free(&scan);
        curlparse_json_free_input(&input);
        return CURLPARSE_ERR_PARSE;
      }
    }
    report.ok = false;
    if(curlparse_render_parse_result(&input,
                                     &scan,
                                     "[]",
                                     &report,
                                     &input.external_refs,
                                     PARAM_OK,
                                     &output_json,
                                     &output_len) != 0) {
      free_argv_rewrites(&rewrites);
      curlparse_guard_report_free(&preflight_report);
      curlparse_guard_report_free(&report);
      curlparse_event_scan_free(&scan);
      curlparse_json_free_input(&input);
      return CURLPARSE_ERR_PARSE;
    }
    if(write_output_json_to_pair(output_json, output_len, out_pair) != 0) {
      free(output_json);
      free_argv_rewrites(&rewrites);
      curlparse_guard_report_free(&preflight_report);
      curlparse_guard_report_free(&report);
      curlparse_event_scan_free(&scan);
      curlparse_json_free_input(&input);
      return CURLPARSE_ERR_PARSE;
    }
    free(output_json);
    free_argv_rewrites(&rewrites);
    curlparse_guard_report_free(&preflight_report);
    curlparse_guard_report_free(&report);
    curlparse_event_scan_free(&scan);
    curlparse_json_free_input(&input);
    return 0;
  }

  tool_init_stderr();
  init_rc = globalconf_init();
  if(init_rc != CURLE_OK) {
    restore_argv_rewrites(&input, &rewrites);
    free_argv_rewrites(&rewrites);
    curlparse_guard_report_free(&preflight_report);
    curlparse_event_scan_free(&scan);
    curlparse_json_free_input(&input);
    return CURLPARSE_ERR_PARSE;
  }
  global_initialized = true;

  curlparse_stub_contract_reset();
  parse_error = parse_args((int)input.argv_count, (argv_item_t *)input.argv);

  if(curlparse_serialize_operations_array_json(global,
                                               &operations_json,
                                               &output_len) != 0 ||
     curlparse_apply_option_guards(&input.runtime_profile,
                                   &scan,
                                   input.parse_mode,
                                   &report) != 0) {
    free(operations_json);
    if(global_initialized) {
      globalconf_free();
    }
    restore_argv_rewrites(&input, &rewrites);
    free_argv_rewrites(&rewrites);
    curlparse_guard_report_free(&preflight_report);
    curlparse_guard_report_free(&report);
    curlparse_event_scan_free(&scan);
    curlparse_json_free_input(&input);
    return CURLPARSE_ERR_PARSE;
  }

  if(global_initialized) {
    globalconf_free();
  }
  restore_argv_rewrites(&input, &rewrites);

  if(curlparse_render_parse_result(&input,
                                   &scan,
                                   operations_json ? operations_json : "[]",
                                   &report,
                                   &input.external_refs,
                                   parse_error,
                                   &output_json,
                                   &output_len) != 0) {
    free(operations_json);
    free_argv_rewrites(&rewrites);
    curlparse_guard_report_free(&preflight_report);
    curlparse_guard_report_free(&report);
    curlparse_event_scan_free(&scan);
    curlparse_json_free_input(&input);
    return CURLPARSE_ERR_PARSE;
  }

  free(operations_json);

  if(write_output_json_to_pair(output_json, output_len, out_pair) != 0) {
    free(output_json);
    free_argv_rewrites(&rewrites);
    curlparse_guard_report_free(&preflight_report);
    curlparse_guard_report_free(&report);
    curlparse_event_scan_free(&scan);
    curlparse_json_free_input(&input);
    return CURLPARSE_ERR_PARSE;
  }

  free(output_json);
  free_argv_rewrites(&rewrites);
  curlparse_guard_report_free(&preflight_report);
  curlparse_guard_report_free(&report);
  curlparse_event_scan_free(&scan);
  curlparse_json_free_input(&input);
  return 0;
}

int32_t curlparse_parse_json(
  uint32_t engine,
  uint32_t input_ptr,
  uint32_t input_len,
  uint32_t out_pair_ptr
)
{
  struct CurlparseEngine *state = engine_from_handle(engine);
  int32_t rc;

  if(!state || state->disposed) {
    return CURLPARSE_ERR_ENGINE;
  }

  rc = curlparse_parse_impl(input_ptr, input_len, out_pair_ptr);
  if(rc == 0) {
    state->parse_count += 1U;
  }
  return rc;
}

int32_t curlparse_generate_json(
  uint32_t engine,
  uint32_t input_ptr,
  uint32_t input_len,
  uint32_t out_pair_ptr
)
{
  struct CurlparseEngine *state = engine_from_handle(engine);
  const char *input_json;
  unsigned char *out_pair;
  char *input_copy;
  char target[32];
  char *output_json = NULL;
  size_t output_len = 0;
  int32_t write_rc;

  if(!state || state->disposed) {
    return CURLPARSE_ERR_ENGINE;
  }

  input_json = curlparse_native_ptr(input_ptr, input_len);
  if(!input_json) {
    return CURLPARSE_ERR_INVALID_INPUT;
  }

  out_pair = curlparse_native_ptr(out_pair_ptr, 8U);
  if(!out_pair) {
    return CURLPARSE_ERR_OUTPUT_PAIR;
  }

  input_copy = malloc((size_t)input_len + 1U);
  if(!input_copy) {
    return CURLPARSE_ERR_PARSE;
  }
  memcpy(input_copy, input_json, input_len);
  input_copy[input_len] = '\0';

  if(extract_json_string_field(input_copy,
                               "target",
                               target,
                               sizeof(target)) != 0 ||
     !planner_target_is_known(target)) {
    free(input_copy);
    return CURLPARSE_ERR_INVALID_INPUT;
  }

  if(render_generate_request_plan(input_copy,
                                  target,
                                  &output_json,
                                  &output_len) != 0) {
    free(input_copy);
    return CURLPARSE_ERR_PARSE;
  }

  write_rc = write_output_json_to_pair(output_json, output_len, out_pair);
  free(output_json);
  free(input_copy);
  return write_rc;
}

int curlparse_parse_native_json(
  const char *input_json,
  char **out_json,
  size_t *out_len
)
{
  uint32_t input_ptr;
  uint32_t pair_ptr;
  uint32_t output_ptr;
  uint32_t output_size;
  uint32_t engine;
  unsigned char *pair_memory;
  char *input_memory;
  const char *output_memory;
  char *copy;
  size_t input_len;
  int32_t parse_rc;

  if(!input_json || !out_json || !out_len) {
    return -1;
  }

  *out_json = NULL;
  *out_len = 0;
  input_len = strlen(input_json);

#ifndef CURLPARSE_WASM
  reset_native_heap();
#endif

  input_ptr = curlparse_alloc((uint32_t)input_len);
  pair_ptr = curlparse_alloc(8U);
  engine = curlparse_engine_new();
  if(!input_ptr || !pair_ptr || !engine) {
    return -3;
  }

  input_memory = curlparse_native_ptr(input_ptr, (uint32_t)input_len);
  pair_memory = curlparse_native_ptr(pair_ptr, 8U);
  if(!input_memory || !pair_memory) {
    return CURLPARSE_ERR_INVALID_INPUT;
  }

  memcpy(input_memory, input_json, input_len);
  parse_rc = curlparse_parse_json(engine, input_ptr, (uint32_t)input_len, pair_ptr);
  curlparse_engine_free(engine);
  if(parse_rc != 0) {
    return (int)parse_rc;
  }

  output_ptr = read_u32_le(pair_memory);
  output_size = read_u32_le(pair_memory + 4);
  output_memory = curlparse_native_ptr(output_ptr, output_size);
  if(!output_memory) {
    return -1;
  }

  copy = malloc((size_t)output_size + 1U);
  if(!copy) {
    return -3;
  }

  memcpy(copy, output_memory, output_size);
  copy[output_size] = '\0';
  *out_json = copy;
  *out_len = output_size;
  return 0;
}
