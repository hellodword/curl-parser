# curl-parser

`curl-parser` captures curl CLI behavior into stable JSON contracts and
support-aware generated code. It reuses the selected curl command-line parser,
does not execute network transfers while parsing, and does not read host files,
stdin, environment variables, home directories, or default `.curlrc`.

## Quick Start

```bash
nix develop --command python scripts/tasks.py doctor
nix develop --command python scripts/tasks.py bootstrap
nix develop --command python scripts/tasks.py generate
nix develop --command python scripts/tasks.py build-wasm
nix develop --command python scripts/tasks.py test
```

Nix is the trusted development entrypoint. For compound commands, run the whole
sequence inside the dev shell:

```bash
nix develop --command bash -lc 'python scripts/tasks.py generate && python scripts/tasks.py test'
```

## Public Surfaces

- Node SDK, browser SDK, and CLI: `packages/node`
- Browser playground: `apps/web-playground`

## Documentation

- Documentation index: `docs/README.md`
- API: `docs/api.md`
- Targets: `docs/targets.md`
- Maintenance: `docs/maintenance.md`
- Contracts: `docs/contracts/ir-v2.md`, `docs/contracts/wasm-abi-v2.md`

## Core Contracts

- `schemas/parse-input.v2.schema.json`
- `schemas/parse-output.v2.schema.json`
- `schemas/curl-ir.v2.schema.json`
- `schemas/diagnostics.v2.schema.json`
- `schemas/generate-input.v2.schema.json`
- `schemas/generate-output.v2.schema.json`
- `schemas/runtime-profile.v2.schema.json`
- `schemas/target-capabilities.v2.schema.json`

The primary wasm artifact is `dist/curl_parser.wasm`.
