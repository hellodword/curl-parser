#include "capture/curlparse_serialize_config.h"

#include <assert.h>
#include <stdlib.h>
#include <string.h>

#include "tool_cfgable.h"
#include "tool_getparam.h"
#include "tool_stderr.h"

static char *parse_and_serialize(const char *const *argv, size_t argc)
{
  CURLcode init_rc;
  ParameterError parse_rc;
  char *json = NULL;
  size_t json_len = 0;

  tool_init_stderr();
  init_rc = globalconf_init();
  assert(init_rc == CURLE_OK);

  parse_rc = parse_args((int)argc, (argv_item_t *)argv);
  assert(parse_rc == PARAM_OK);

  assert(curlparse_serialize_operations_json(global, &json, &json_len) == 0);
  assert(json != NULL);
  assert(json_len > 0);

  globalconf_free();
  return json;
}

int main(void)
{
  char *json;

  {
    const char *const argv[] = {
      "curl", "-H", "A: B", "-A", "ua", "https://example.com"
    };
    json = parse_and_serialize(argv, 6);
    assert(strstr(json, "\"headers\":[\"A: B\"]") != NULL);
    assert(strstr(json, "\"userAgent\":\"ua\"") != NULL);
    free(json);
  }

  {
    const char *const argv[] = {
      "curl", "-u", "user:pass", "https://example.com"
    };
    json = parse_and_serialize(argv, 4);
    assert(strstr(json, "\"userPwd\":{\"value\":\"user:pass\",\"sensitive\":true}") != NULL);
    free(json);
  }

  {
    const char *const argv[] = {
      "curl", "--proxy", "http://proxy.example", "https://example.com"
    };
    json = parse_and_serialize(argv, 4);
    assert(strstr(json, "\"proxy\":\"http://proxy.example\"") != NULL);
    free(json);
  }

  {
    const char *const argv[] = {
      "curl", "--connect-timeout", "2", "--max-time", "5",
      "https://example.com"
    };
    json = parse_and_serialize(argv, 6);
    assert(strstr(json, "\"connectTimeoutMs\":2000") != NULL);
    assert(strstr(json, "\"maxTimeMs\":5000") != NULL);
    free(json);
  }

  return 0;
}
