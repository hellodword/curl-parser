# API

`curl-parser` exposes parse and generate contracts through the Node SDK, browser
SDK, and CLI.

The parser is host-isolated. It does not read host files, stdin, environment
variables, home directories, or default `.curlrc`. Inputs that need host data are
reported as diagnostics or `externalRefs` in the IR.

## Node And CLI

Package: `@hellodword/curl-parser`.

Install from GitHub Packages:

```text
@hellodword:registry=https://npm.pkg.github.com
```

```bash
npm install @hellodword/curl-parser
```

Parse from a shell command string:

```js
import { parseCurl } from "@hellodword/curl-parser";

const result = await parseCurl("curl -H 'accept: application/json' https://example.com");
console.log(result.ir.schemaVersion);
```

Parse from argv when shell tokenization is already done:

```js
const result = await parseCurl(["curl", "--data-raw", "hello", "https://example.com"]);
```

Generate code:

```js
import { generateCode, parseCurl } from "@hellodword/curl-parser";

const parsed = await parseCurl("curl --data-raw hello https://example.com");
const output = await generateCode(parsed, { target: "js.fetch" });
console.log(output.files[0].content);
```

CLI:

```bash
curl-parser targets
curl-parser parse -- "curl https://example.com"
curl-parser generate --target js.fetch -- "curl https://example.com"
```

Parse failures are reported as `ParseOutput` JSON. ABI failures throw
`CurlParserError`. Shell expansion is not executed; unsupported shell syntax is
reported in diagnostics before the curl parser sees argv.

## Browser

Use the browser entry and provide Wasm bytes or a Wasm module.

```ts
import { createParser } from "@hellodword/curl-parser/browser";

const wasmBytes = await fetch("/curl_parser.wasm").then((response) => response.arrayBuffer());
const parser = await createParser({ wasmBytes, imports: {} });
```

The browser entry does not import `node:fs` or `node:wasi`.

## Host References

Explicit local dependencies are returned as IR external refs:

```js
const parsed = await parseCurl(["curl", "--data", "@payload.txt", "https://example.com"]);
console.log(parsed.ir.externalRefs[0]);
```

Generators report `support` for the selected target. Browser `js.fetch` reports
local filesystem refs as unsupported; Node and server-side targets can emit
runtime reads where supported.
