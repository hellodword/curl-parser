# curl-parser

`curl-parser` parses curl argv into structured JSON by reusing the selected
curl command-line parser source. It does not perform network transfers.

Scope:

- Parse argv-form curl CLI syntax only.
- Do not perform network transfers.
- Do not read host files by default.
- Use curl source version `curl-8_20_0`.
- Build native and wasm artifacts through a configurable C compiler. The
  default `CC`/`WASM_CC` is `zig cc`.

Primary artifact:

- `dist/curl_parser.wasm`

Host examples:

- `wrappers/node/`
- `wrappers/python/`

Schemas:

- `schemas/parse-input.schema.json`
- `schemas/parse-output.schema.json`
- `schemas/runtime-profile.schema.json`

## Build

```bash
python scripts/tasks.py bootstrap
python scripts/tasks.py generate
python scripts/tasks.py build-wasm
python scripts/tasks.py test
```

`bootstrap` downloads the selected curl source into `third_party/`. That
directory is a local build input, not a git-tracked source tree.

To override the native compiler:

```bash
CC=clang python scripts/tasks.py build-native
```

To override the wasm compiler:

```bash
WASM_CC="zig cc" python scripts/tasks.py build-wasm
```

## Input

Only argv input is supported:

```json
{
  "inputMode": "argv",
  "argv": ["curl", "--http3", "--json", "{\"a\":1}", "https://example.com"]
}
```

Shell command strings are intentionally out of scope. Callers that accept a
command line must split it into argv before calling the parser.

## Wasm ABI

The wasm module exports a stable C ABI:

```c
uint32_t curlparse_abi_version(void);
uint32_t curlparse_alloc(uint32_t size);
void curlparse_free(uint32_t ptr, uint32_t size);
int32_t curlparse_parse(uint32_t input_ptr, uint32_t input_len, uint32_t out_pair_ptr);
```

The host writes UTF-8 JSON into wasm memory and receives an output
`{ptr,len}` pair. curl parse failures are reported in output JSON, not as ABI
return codes.
