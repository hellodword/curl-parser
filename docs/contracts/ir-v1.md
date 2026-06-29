# Curl IR v1

Schema: `schemas/curl-ir.v1.schema.json`.

The parser is host-isolated. It does not read files, stdin, environment
variables, home directories, default `.curlrc`, or filesystem metadata. Only
explicit argv values enter the IR.

## Top-Level Shape

- `schemaVersion`: always `curl-ir/v1`
- `curlSourceVersion`: curl source version used by the embedded parser
- `command`: normalized input argv and optional spans
- `externalRefs`: local files, stdin, output paths, OS stores, sockets, and other
  host resources referenced by explicit options
- `runtime.profile`: runtime profile used for protocol, feature, and option
  guards
- `globals`: command-wide options
- `groups`: transfer groups separated by `--next`
- `diagnostics`: parse warnings and errors

## External References

`externalRefs[]` entries have:

- `id`: stable reference id such as `external-0`
- `kind`: `file`, `stdin`, `directory`, `output-file`, `cookie-jar`, `netrc`,
  `unix-socket`, `os-trust-store`, `os-client-cert-store`, `network-interface`,
  or `local-file-url`
- `access`: intended access such as `read`, `write`, or `connect`
- `option`: originating curl option when available
- `value`: argv value after curl-style reference parsing, when applicable
- `source`: argv source span

Request bodies, headers, cookies, TLS fields, and output-related nodes can refer
back to these entries with `externalRefId`. Generators decide whether a target
can emit runtime file/stdin/socket handling or must report unsupported support.

## Host Dependencies Rejected At Parse Time

Options that would change argv or the request set by reading host state fail with
diagnostics instead of being modeled as external refs. Examples include
`--config`, default `.curlrc` loading, `--url @file`, `--variable`,
`--expand-*`, file-mtime `--time-cond`, `--libcurl`, `--manual`, `--help`, and
`--version`.
