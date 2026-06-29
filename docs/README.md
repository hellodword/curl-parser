# Documentation

This directory holds the canonical documentation for `curl-parser`.

## Documents

- `api.md`: public API for Node, browser, and CLI callers.
- `targets.md`: code generation targets, generated files, and capability notes.
- `maintenance.md`: repository layout, build tasks, test commands, artifact
  policy, curl source handling, and known regression traps.
- `contracts/ir-v1.md`: Curl IR v1 contract.
- `contracts/wasm-abi-v1.md`: Wasm ABI v1 contract.

## Source Of Truth

- Public API behavior is documented in `docs/api.md`.
- Target support is documented in `docs/targets.md` and backed by
  `generators/capabilities/*.json`.
- Build, test, release preflight, artifact, and curl upgrade procedures are
  documented in `docs/maintenance.md`.
- Package README files are package entrypoints only. They should link here
  instead of duplicating full API or target documentation.
