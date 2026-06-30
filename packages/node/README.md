# Node Package

Primary TypeScript SDK for `curl-parser`.

## Install

This package is published manually to GitHub Packages. Configure the scope in a
project `.npmrc`:

```text
@hellodword:registry=https://npm.pkg.github.com
```

Then install:

```bash
npm install @hellodword/curl-parser
```

Authenticated installs require an npm token that can read GitHub Packages.

## Node

```ts
import { createParser, parseCurl, listTargets } from "@hellodword/curl-parser";

const parsed = await parseCurl("curl -H 'accept: application/json' https://example.com");
console.log(parsed.ir);
console.log(listTargets());

const parser = await createParser();
try {
  const result = await parser.parseCurl(["curl", "https://example.com"]);
  console.log(result.ok);
} finally {
  parser.dispose();
}
```

Generate from an existing IR without instantiating Wasm:

```ts
import { generateCodeFromIr } from "@hellodword/curl-parser";

const output = generateCodeFromIr(parsed.ir, { target: "js.fetch" });
console.log(output.files[0].content);
```

## Browser

```ts
import { createParser } from "@hellodword/curl-parser/browser";

const wasmBytes = await fetch("/curl_parser.wasm").then((response) => response.arrayBuffer());
const parser = await createParser({ wasmBytes, imports: {} });
```

The browser entry does not import `node:fs` or `node:wasi`; callers provide the
Wasm bytes/module and imports.

## CLI

```bash
curl-parser targets
curl-parser parse -- "curl https://example.com"
```

## More Documentation

- API: `../../docs/api.md`
- Targets: `../../docs/targets.md`
- Contracts: `../../docs/contracts/ir-v2.md`,
  `../../docs/contracts/wasm-abi-v2.md`
