# Targets

Generators consume Curl IR and target capability data. Capability manifests live
under `generators/capabilities/` and use
`schemas/target-capabilities.v1.schema.json`.

## Target Summary

| Target | Library | Generated files | Capability manifest |
| --- | --- | --- | --- |
| `c.libcurl` | libcurl C API | `main.c` | `generators/capabilities/c.libcurl.json` |
| `python.requests` | `requests` | `main.py` | `generators/capabilities/python.requests.json` |
| `js.fetch` | standard Fetch API | `main.js` | `generators/capabilities/js.fetch.json` |
| `js.undici` | `undici` | `main.mjs` | `generators/capabilities/js.undici.json` |
| `go.net_http` | Go `net/http` | `main.go`, optional helpers | `generators/capabilities/go.net_http.json` |
| `rust.reqwest` | `reqwest` | `Cargo.toml`, `src/main.rs`, `src/async_main.rs` | `generators/capabilities/rust.reqwest.json` |

## c.libcurl

- URL, method, headers, body, TLS verify, proxy, HTTP/2, and HTTP/3 are native
  when supported by the runtime profile.
- Multipart form data is native through curl mime APIs.
- File, stdin, output, and local capability needs are represented through
  `externalRefs`; generated C uses libcurl-native behavior where supported.

## python.requests

- URL, method, headers, raw body, JSON body, multipart, proxy, TLS verify, auth,
  cookies, redirects, and timeouts are native.
- HTTP/2 is lossy because `requests` does not expose curl-style HTTP/2
  selection.
- HTTP/3 is unsupported.
- Cookie jar paths and other local refs may require runtime helper behavior.

## js.fetch

- URL, method, headers, raw body, JSON body, multipart, redirects, and timeout
  helpers are supported where Fetch exposes them.
- Browser runtimes can reject explicit Cookie headers.
- HTTP version selection, proxy configuration, TLS verify overrides, and local
  filesystem refs are unsupported.

## js.undici

- URL, method, headers, raw body, JSON body, multipart, proxy, TLS verify,
  redirects, and timeout controls are supported through `undici` APIs.
- Proxy support uses runtime helper wiring through `ProxyAgent`.
- HTTP/2 and HTTP/3 selection are unsupported.
- Local refs may require runtime file reads or helper behavior.

## go.net_http

- URL, method, headers, raw body, JSON body, multipart, proxy, TLS verify,
  redirects, timeout controls, and HTTP/2 transport hints are native.
- HTTP/3 is unsupported.
- Cookie jar files and other local refs may require helper code.

## rust.reqwest

- Blocking and async entrypoints are generated.
- URL, method, headers, raw body, JSON body, multipart, proxy, TLS verify,
  redirects, timeout controls, HTTP/2, auth, and cookies are native.
- HTTP/3 is not treated as a stable generated capability.
- Cookie jar files and other local refs may require helper code.
