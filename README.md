# curl-parser

`curl-parser` captures curl CLI behavior into stable JSON contracts and
support-aware generated code. It reuses the selected curl command-line parser,
does not execute network transfers while parsing, and does not read host files,
stdin, environment variables, home directories, or default `.curlrc`.

## Quick Start

```bash
python scripts/tasks.py doctor
python scripts/tasks.py bootstrap
python scripts/tasks.py generate
python scripts/tasks.py build-wasm
python scripts/tasks.py test
```

The same commands run inside and outside Nix. With pinned tools:

```bash
nix develop
python scripts/tasks.py test
```

## Public Surfaces

- Node SDK, browser SDK, and CLI: `packages/node`
- Browser playground: `apps/web-playground`

## Documentation

- Documentation index: `docs/README.md`
- API: `docs/api.md`
- Targets: `docs/targets.md`
- Maintenance: `docs/maintenance.md`
- Contracts: `docs/contracts/ir-v1.md`, `docs/contracts/wasm-abi-v1.md`

## Core Contracts

- `schemas/parse-input.v1.schema.json`
- `schemas/parse-output.v1.schema.json`
- `schemas/curl-ir.v1.schema.json`
- `schemas/diagnostics.v1.schema.json`
- `schemas/generate-input.v1.schema.json`
- `schemas/generate-output.v1.schema.json`
- `schemas/runtime-profile.v1.schema.json`
- `schemas/target-capabilities.v1.schema.json`

The primary wasm artifact is `dist/curl_parser.wasm`.
