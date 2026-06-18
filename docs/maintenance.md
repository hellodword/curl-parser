# Maintenance Notes

## Source Of Truth

- curl option names and argument types come from
  `third_party/curl/curl-8_20_0/src/tool_getparam.c` and
  `tool_getparam.h`.
- Runtime protocol and feature behavior is modeled through
  `runtimeProfile`, not through host libcurl.
- Guard metadata is regenerated from curl `docs/cmdline-opts/*.md` with
  `python scripts/tasks.py generate`.

## Known Regression Traps

- `--next` creates a new operation. Keep event scanning and serialized
  `OperationConfig` traversal aligned.
- `--config` must use virtual files unless `allowHostFileRead` is explicitly
  enabled. Default `.curlrc` loading stays disabled.
- `--proto` can produce diagnostics for unsupported protocols, while
  `--proto-default` must produce an error.
- Node WASI warnings on stderr are not parser output. Compare normalized JSON
  only in native-vs-wasm checks.
- wasm pointers are raw 32-bit offsets under `CURLPARSE_WASM`; host wrappers
  must allocate input/output buffers through the exported ABI.

## Standard Checks

```bash
python scripts/tasks.py bootstrap
python scripts/tasks.py generate
python scripts/tasks.py lint
python scripts/tasks.py test
python scripts/tasks.py size --budget 110000
```

Use `FUZZ_CASES=10000 python scripts/tasks.py test` before release if fuzz
coverage should match release depth.

## Curl Upgrade

1. Run `python scripts/upgrade_curl_version.py --old-version 8.20.0 --new-tag curl-x_y_z`.
2. Inspect the generated upgrade report.
3. Review added or removed source files, options, guards, `OperationConfig`
   fields, and `tool_libinfo` protocol/feature state.
4. Add or update golden cases before accepting behavior changes.
