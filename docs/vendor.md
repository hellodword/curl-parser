# Curl Source Policy

`third_party/curl/curl-*` is a generated local build input and is ignored by
git.

## Why Not Commit `third_party`

The current parser compiles a narrow subset of curl's command-line parser and
curlx helper files. A full copied curl tree brings in unused transfer, TLS,
SSH, FTP, HTTP, and QUIC implementation files that are not part of this
project's runtime.

## If Source Must Be Committed Later

Commit a curated snapshot, not a submodule:

- Include only parser-required `src` files, required `lib/curlx` helpers,
  required headers, `docs/cmdline-opts`, `COPYING`, `README.md`, and a manifest.
- Keep upstream tag, commit SHA, file size, and SHA-256 checksums in the
  manifest.
- Do not use a git submodule for the normal case. A submodule cannot represent
  the curated subset, still adds checkout/release complexity, and makes CI
  depend on nested repository state rather than a simple manifest.

## Refresh

```bash
python scripts/tasks.py bootstrap
python scripts/tasks.py generate
```
