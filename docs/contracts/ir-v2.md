# Curl IR v2

Schema: `schemas/curl-ir.v2.schema.json`.

The parser is host-isolated. It does not read files, stdin, environment
variables, home directories, default `.curlrc`, or filesystem metadata. Only
explicit argv values enter the IR.

## Top-Level Shape

- `schemaVersion`: always `curl-ir/v2`
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
  `unix-socket`, `os-trust-store`, `os-client-cert-store`,
  `network-interface`, `dns-interface`, `trace-output`, `header-output`,
  `tls-ca-file`, `tls-client-cert`, `tls-client-key`, `proxy-client-cert`,
  `proxy-client-key`, or `local-file-url`
- `access`: intended access such as `read`, `write`, or `connect`
- `option`: originating curl option when available
- `value`: argv value after curl-style reference parsing, when applicable
- `source`: argv source span

Request bodies, headers, cookies, TLS fields, and output-related nodes can refer
back to these entries with `externalRefId`. Generators decide whether a target
can emit runtime file/stdin/socket handling or must report unsupported support.

## Effective Domains

Each transfer has `effective` request semantics after group-level options are
applied. `--next` starts a new group, so options before it do not leak into later
groups.

- `httpVersion`: object for explicit HTTP version flags, with `value`, `policy`,
  `source`, and `sourceSpan`; absent/default transport negotiation is `null`.
- `proxy`: proxy URL, proxy headers, proxy auth, tunnel mode, proxy HTTP version,
  and proxy TLS material.
- `tls`: verification, CA/client certificate refs, key refs, version bounds,
  cipher settings, native store, and auto-client-cert flags.
- `network`: interface/local port/IP-family/socket/connect-to/HAProxy protocol
  behavior.
- `dns`: DNS interface, DNS source addresses, DoH URL, DoH verification, DNS
  servers, and `--resolve` overrides.
- `debug`: verbose and trace output settings, trace config/time/ids, stderr, and
  header output refs.

## Host Dependencies Rejected At Parse Time

Options that would change argv or the request set by reading host state fail with
diagnostics instead of being modeled as external refs. Examples include
`--config`, default `.curlrc` loading, `--url @file`, `--variable`,
`--expand-*`, file-mtime `--time-cond`, `--libcurl`, `--manual`, `--help`, and
`--version`.
