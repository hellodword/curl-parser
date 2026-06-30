import assert from "node:assert/strict";

import { generateCode, parseCurl } from "../../packages/node/dist/node.js";

const targets = [
  "python.requests",
  "python.httpx",
  "js.fetch",
  "js.undici",
  "js.axios",
  "go.net_http",
  "rust.reqwest",
];

const cases = [
  ["curl", "--json", "{\"name\":\"demo\"}", "https://api.example.com/widgets"],
  ["curl", "-H", "x-test: yes", "--data-raw", "hello", "https://example.com"],
  ["curl", "-F", "a=b", "https://example.com"],
];

for (const target of targets) {
  for (const argv of cases) {
    const parsed = await parseCurl(argv);
    const output = await generateCode(parsed, { target });
    assert(output.files.length > 0, `${target} should generate files`);
    for (const file of output.files) {
      assert.equal(
        file.content.includes("\t"),
        false,
        `${target} ${file.path} contains a tab character`,
      );
    }
  }
}

console.log("generated code no tabs ok");
