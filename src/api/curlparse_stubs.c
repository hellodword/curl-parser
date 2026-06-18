#include "runtime/curlparse_curl_compat.h"

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "curl/curl.h"
#include "curl/urlapi.h"
#include "tool_stderr.h"
#include "tool_help.h"
#include "tool_writeout_json.h"
#include "curlx/dynbuf.h"

FILE *tool_stderr = NULL;

static char *curlparse_vaprintf(const char *format, va_list args)
{
  va_list copy;
  int needed;
  char *buffer;

  va_copy(copy, args);
  needed = vsnprintf(NULL, 0, format, copy);
  va_end(copy);
  if(needed < 0) {
    return NULL;
  }

  buffer = malloc((size_t)needed + 1U);
  if(!buffer) {
    return NULL;
  }

  vsnprintf(buffer, (size_t)needed + 1U, format, args);
  return buffer;
}

int curl_strequal(const char *s1, const char *s2)
{
  if(!s1 || !s2) {
    return 0;
  }
  return strcasecmp(s1, s2) == 0;
}

int curl_strnequal(const char *s1, const char *s2, size_t n)
{
  if(!s1 || !s2) {
    return 0;
  }
  return strncasecmp(s1, s2, n) == 0;
}

int curl_msnprintf(char *buffer, size_t maxlength, const char *format, ...)
{
  int rc;
  va_list args;

  va_start(args, format);
  rc = vsnprintf(buffer, maxlength, format, args);
  va_end(args);
  return rc;
}

int curl_mvsnprintf(char *buffer, size_t maxlength,
                    const char *format, va_list args)
{
  return vsnprintf(buffer, maxlength, format, args);
}

int curl_mfprintf(FILE *fd, const char *format, ...)
{
  int rc;
  va_list args;

  va_start(args, format);
  rc = vfprintf(fd, format, args);
  va_end(args);
  return rc;
}

int curl_mvfprintf(FILE *fd, const char *format, va_list args)
{
  return vfprintf(fd, format, args);
}

char *curl_maprintf(const char *format, ...)
{
  char *buffer;
  va_list args;

  va_start(args, format);
  buffer = curlparse_vaprintf(format, args);
  va_end(args);
  return buffer;
}

char *curl_mvaprintf(const char *format, va_list args)
{
  return curlparse_vaprintf(format, args);
}

void curl_free(void *ptr)
{
  free(ptr);
}

char *curl_getenv(const char *variable)
{
  const char *value = getenv(variable);
  size_t size;
  char *copy;

  if(!value) {
    return NULL;
  }

  size = strlen(value) + 1U;
  copy = malloc(size);
  if(!copy) {
    return NULL;
  }

  memcpy(copy, value, size);
  return copy;
}

char *curl_easy_escape(CURL *curl, const char *string, int length)
{
  size_t size;
  char *copy;
  (void)curl;

  if(!string) {
    return NULL;
  }

  if(length < 0) {
    size = strlen(string);
  }
  else {
    size = (size_t)length;
  }

  copy = malloc(size + 1U);
  if(!copy) {
    return NULL;
  }

  memcpy(copy, string, size);
  copy[size] = '\0';
  return copy;
}

CURLcode curl_global_trace(const char *config)
{
  (void)config;
  return CURLE_OK;
}

CURLcode curl_global_init(long flags)
{
  (void)flags;
  return CURLE_OK;
}

void curl_global_cleanup(void)
{
}

struct curl_slist *curl_slist_append(struct curl_slist *list, const char *data)
{
  struct curl_slist *node = malloc(sizeof(*node));
  struct curl_slist *tail = list;
  size_t size;

  if(!node) {
    return NULL;
  }

  size = strlen(data) + 1U;
  node->data = malloc(size);
  if(!node->data) {
    free(node);
    return NULL;
  }
  memcpy(node->data, data, size);
  node->next = NULL;

  if(!list) {
    return node;
  }

  while(tail->next) {
    tail = tail->next;
  }
  tail->next = node;
  return list;
}

void curl_slist_free_all(struct curl_slist *list)
{
  while(list) {
    struct curl_slist *next = list->next;
    free(list->data);
    free(list);
    list = next;
  }
}

void curl_mime_free(curl_mime *mime)
{
  free(mime);
}

curl_mime *curl_mime_init(CURL *easy)
{
  (void)easy;
  return malloc(1U);
}

curl_mimepart *curl_mime_addpart(curl_mime *mime)
{
  (void)mime;
  return malloc(1U);
}

CURLcode curl_mime_name(curl_mimepart *part, const char *name)
{
  (void)part;
  (void)name;
  return CURLE_OK;
}

CURLcode curl_mime_filename(curl_mimepart *part, const char *filename)
{
  (void)part;
  (void)filename;
  return CURLE_OK;
}

CURLcode curl_mime_type(curl_mimepart *part, const char *mimetype)
{
  (void)part;
  (void)mimetype;
  return CURLE_OK;
}

CURLcode curl_mime_encoder(curl_mimepart *part, const char *encoding)
{
  (void)part;
  (void)encoding;
  return CURLE_OK;
}

CURLcode curl_mime_data(curl_mimepart *part, const char *data, size_t datasize)
{
  (void)part;
  (void)data;
  (void)datasize;
  return CURLE_OK;
}

CURLcode curl_mime_filedata(curl_mimepart *part, const char *filename)
{
  (void)part;
  (void)filename;
  return CURLE_OK;
}

CURLcode curl_mime_data_cb(
  curl_mimepart *part,
  curl_off_t datasize,
  curl_read_callback readfunc,
  curl_seek_callback seekfunc,
  curl_free_callback freefunc,
  void *arg
)
{
  (void)part;
  (void)datasize;
  (void)readfunc;
  (void)seekfunc;
  (void)freefunc;
  (void)arg;
  return CURLE_OK;
}

CURLcode curl_mime_subparts(curl_mimepart *part, curl_mime *subparts)
{
  (void)part;
  (void)subparts;
  return CURLE_OK;
}

CURLcode curl_mime_headers(
  curl_mimepart *part,
  struct curl_slist *headers,
  int take_ownership
)
{
  (void)part;
  (void)headers;
  (void)take_ownership;
  return CURLE_OK;
}

CURLU *curl_url(void)
{
  return malloc(1U);
}

void curl_url_cleanup(CURLU *u)
{
  free(u);
}

CURLUcode curl_url_set(
  CURLU *u,
  CURLUPart what,
  const char *part,
  unsigned int flags
)
{
  (void)u;
  (void)what;
  (void)part;
  (void)flags;
  return CURLUE_OK;
}

time_t curl_getdate(const char *p, const time_t *unused)
{
  (void)p;
  (void)unused;
  return (time_t)-1;
}

void tool_init_stderr(void)
{
  tool_stderr = stderr;
}

void tool_set_stderr_file(const char *filename)
{
  (void)filename;
  tool_stderr = stderr;
}

void tool_help(const char *category)
{
  (void)category;
}

void tool_list_engines(void)
{
}

void tool_version_info(void)
{
}

size_t get_terminal_columns(void)
{
  return 80U;
}

int jsonquoted(const char *in, size_t len, struct dynbuf *out, bool lowercase)
{
  (void)lowercase;
  return curlx_dyn_addn(out, in, len) ? 1 : 0;
}

char *getpass_r(const char *prompt, char *buffer, size_t buflen)
{
  (void)prompt;
  if(!buffer || !buflen) {
    return NULL;
  }
  buffer[0] = '\0';
  return buffer;
}
