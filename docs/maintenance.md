# Maintenance

This document is the repository maintenance runbook for `curl-parser`.

## Repository Layout

Canonical source roots:

- `core/c`: C parser core, public C/Wasm ABI header, native CLI source, and C
  tests.
- `core/wasm`: Wasm build metadata for the core layer.
- `packages/node`: the JavaScript SDK, browser entry, CLI, and npm package.
- `generators`: target code generators and capability manifests.
- `apps/web-playground`: application.
- `tests`: test runners and language-level test code.
- `fixtures`: golden cases, fuzz seeds, replay data, and other test data.
- `scripts`: build, curl-source, release, and maintenance tooling.
- `config`: repository metadata consumed by build and release tools.

Generated files are local artifacts under `build/`, `dist/`, or package artifact
directories ignored by git. Run `nix develop --command python scripts/tasks.py generate`
before building from a fresh checkout.

## Environment

Nix is the trusted development entrypoint. Run build, generation, test, package,
and size tasks through the dev shell:

```bash
nix develop --command python scripts/tasks.py doctor
nix develop --command python scripts/tasks.py bootstrap
nix develop --command python scripts/tasks.py generate
nix develop --command python scripts/tasks.py build-native
nix develop --command python scripts/tasks.py build-wasm
nix develop --command python scripts/tasks.py test
```

For compound commands, enter the dev shell once:

```bash
nix develop --command bash -lc 'python scripts/tasks.py generate && python scripts/tasks.py test'
```

The dev shell sets the default compiler command to `zig cc` for both native and
wasm builds. To test a compiler override, pass it through `nix develop`:

```bash
nix develop --command bash -lc 'CC=clang python scripts/tasks.py build-native'
nix develop --command bash -lc 'WASM_CC="zig cc" python scripts/tasks.py build-wasm'
```

## Build Tasks

All build entrypoints live in `scripts/tasks.py`.

Standard local build:

```bash
nix develop --command python scripts/tasks.py doctor
nix develop --command python scripts/tasks.py bootstrap
nix develop --command python scripts/tasks.py generate
nix develop --command python scripts/tasks.py build-native
nix develop --command python scripts/tasks.py build-native-shared
nix develop --command python scripts/tasks.py build-wasm
nix develop --command python scripts/tasks.py build-web
nix develop --command python scripts/tasks.py test
```

Task reference:

- `doctor`: checks Python, Node.js, Git, `CC`, `WASM_CC`, curl source, and
  generated inputs.
- `bootstrap`: downloads the pinned curl source into `third_party/`.
- `generate`: refreshes option catalogs, guard tables, generated headers, source
  response files, and minimal support response files.
- `build-native`: builds `build/native/curlparse_cli`.
- `build-native-shared`: builds `build/native/libcurlparse.so`.
- `build-wasm`: builds `dist/curl_parser.wasm`.
- `build-web`: builds `apps/web-playground/dist`.
- `lint`: checks Python syntax, Node syntax, JSON schema syntax, and contract
  fixtures.
- `test`: runs C tests, golden tests, native-vs-wasm comparison, fuzz checks,
  fixture replay checks, generator checks, and package checks.
- `size`: prints Wasm section sizes and can enforce a size budget.
- `pack-node`: builds the TypeScript SDK package and validates npm pack output.
- `release-check`: runs the full local release preflight.

## Artifacts

Generated artifacts are ignored by git:

- `build/`
- `dist/`
- `third_party/`
- `packages/node/dist/`
- `packages/node/schemas/`
- `packages/node/wasm/`
- `packages/node/LICENSE`
- `apps/web-playground/dist/`
- `apps/web-playground/node_modules/`

Do not commit those paths. Regenerate them with the task graph.

The Node package-local artifacts under `packages/node/` are still required in
the npm tarball. They are produced by `python scripts/build/build_node_package.py`,
which rebuilds `dist/`, copies root `schemas/`, copies `dist/curl_parser.wasm`
into `wasm/`, and copies the root `LICENSE`.

## Wasm Asset Policy

`dist/curl_parser.wasm` is the only Wasm build source. The Node package-local
copy under `packages/node/wasm/` is generated for npm packaging and remains
ignored by git.

When the Wasm changes, rebuild the Node package artifacts with:

```bash
nix develop --command python scripts/tasks.py build-wasm
nix develop --command python scripts/build/build_node_package.py
```

`lint` and `release-check` rebuild the package-local copy from
`dist/curl_parser.wasm`.

The current `158000` byte size budget is for the parse-only Wasm ABI plus the
expanded IR v2 parse result renderer. The main growth versus the earlier
baseline comes from serializing proxy, TLS, network, DNS, debug, HTTP version,
external reference, and runtime profile fields in parse output. The `size` task
also checks the Wasm export table and string payload for generator residue, so
the budget is not a substitute for keeping code generation out of the Wasm
module.

## Web Playground

The browser playground is an independent Vite, Vue, and TypeScript app under
`apps/web-playground`. It has its own `package.json` and `package-lock.json`;
there is no root npm workspace.

Build the Wasm first, then install and run the app:

```bash
nix develop --command python scripts/tasks.py build-wasm
nix develop --command npm --prefix apps/web-playground ci
nix develop --command npm --prefix apps/web-playground run dev
```

The playground imports `@hellodword/curl-parser/browser` through a Vite alias
that points at `packages/node/src/browser.ts`, so it does not depend on
committed `packages/node/dist` files. Its Wasm asset comes from root
`dist/curl_parser.wasm`.

## Source Of Truth

- The selected curl source is defined in `config/curl-source.json`.
- curl option names and argument types come from
  `third_party/curl/<tag>/src/tool_getparam.c` and `tool_getparam.h`.
- Runtime protocol and feature behavior is modeled through `runtimeProfile`, not
  through host libcurl.
- Guard metadata is regenerated from curl `docs/cmdline-opts/*.md` with
  `nix develop --command python scripts/tasks.py generate`.
- Stub contract headers are regenerated from
  `core/c/src/runtime/stub-contracts.json`; the JSON and tests are the source of
  truth.

## Known Regression Traps

- `--next` creates a new operation. Keep event scanning and serialized
  `OperationConfig` traversal aligned.
- `--config`, default `.curlrc`, `--url @file`, variable expansion options, and
  other parse-time host readers must fail with concrete host-dependency
  diagnostics.
- Explicit runtime inputs and outputs such as `--data @file`, `--upload-file`,
  `--cookie-jar`, TLS material paths, and Unix sockets must be represented as
  `externalRefs` without probing the host.
- `--proto` can produce diagnostics for unsupported protocols, while
  `--proto-default` must produce an error.
- Node WASI warnings on stderr are not parser output. Compare normalized JSON
  only in native-vs-wasm checks.
- Wasm pointers are raw 32-bit offsets under `CURLPARSE_WASM`; hosts allocate
  input/output buffers through the exported ABI.

## Standard Checks

```bash
nix develop --command python scripts/tasks.py bootstrap
nix develop --command python scripts/tasks.py generate
nix develop --command python scripts/tasks.py lint
nix develop --command python scripts/tasks.py test
nix develop --command python scripts/tasks.py size --budget 158000
```

Use `nix develop --command bash -lc 'FUZZ_CASES=10000 python scripts/tasks.py test'`
before release if fuzz coverage should match release depth.

## Curl Upgrade

1. Run `nix develop --command python scripts/curl/upgrade_curl_version.py --new-tag curl-x_y_z`.
2. Inspect the generated upgrade report.
3. Review added or removed source files, options, guards, `OperationConfig`
   fields, and `tool_libinfo` protocol/feature state.
4. Add or update golden cases before accepting behavior changes.

The curl source is downloaded by `scripts/curl/vendor_curl.py` according to
`config/curl-source.json`. Keep local source inventory changes generated by
`nix develop --command python scripts/tasks.py generate`; do not hand-edit response
files except when debugging a regeneration failure.
