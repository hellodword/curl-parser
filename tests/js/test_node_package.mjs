import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import {
  createParser,
  generateCode,
  generateCodeFromIr,
  listSchemaExports,
  listTargets,
  parseCurl,
} from "../../packages/node/dist/node.js";
import * as browserEntry from "../../packages/node/dist/browser.js";

const execFileAsync = promisify(execFile);

const targets = listTargets();
assert.deepEqual(targets, [
  "python.requests",
  "python.httpx",
  "js.fetch",
  "js.undici",
  "js.axios",
  "go.net_http",
  "rust.reqwest",
]);
assert(targets.includes("js.fetch"));
assert(targets.includes("python.requests"));
assert(listSchemaExports().includes("curlIrV2"));
assert(listSchemaExports().includes("targetCapabilitiesV2"));
assert.equal(typeof browserEntry.createParser, "function");
assert.equal(typeof browserEntry.createBrowserWasiImports, "function");
assert.equal(typeof browserEntry.parseShellCommand, "function");

const packageJson = JSON.parse(await readFile("packages/node/package.json", "utf8"));
assert.equal(packageJson.name, "@hellodword/curl-parser");
assert.equal(packageJson.publishConfig?.["@hellodword:registry"], "https://npm.pkg.github.com");

const parser = await createParser();
try {
  const output = await parser.parseCurl(["curl", "https://example.com"]);
  assert.equal(output.ok, true);
  assert.equal(output.ir?.schemaVersion, "curl-ir/v2");
  assert.equal(output.argv?.[1], "https://example.com");
} finally {
  parser.dispose();
}

const shellOutput = await parseCurl("curl -H 'x-test: yes' https://example.com");
assert.equal(shellOutput.ok, true);
assert.equal(shellOutput.ir?.groups?.[0]?.transfers?.[0]?.url, "https://example.com");

const shellObjectOutput = await parseCurl({
  schemaVersion: "curl-parse-input/v2",
  inputMode: "shell",
  command: "curl -H 'x-test: yes' https://example.com",
  shellDialect: "posix-sh",
});
assert.equal(shellObjectOutput.ok, true);
assert.equal(shellObjectOutput.ir?.groups?.[0]?.transfers?.[0]?.url, "https://example.com");

const implicitUrlOutput = await parseCurl(["curl", "example.com"]);
const implicitTransfer = implicitUrlOutput.ir?.groups?.[0]?.transfers?.[0];
assert.equal(implicitTransfer?.url, "http://example.com");
assert.equal(implicitTransfer?.rawUrl, "example.com");
assert.equal(implicitTransfer?.urlResolution?.source, "curl-default");

const generated = await generateCode(shellOutput, { target: "js.fetch" });
assert.equal(generated.schemaVersion, "curl-generate-output/v2");
assert.equal(generated.target, "js.fetch");
assert.equal(generated.files[0]?.path, "main.js");
assert(generated.files[0]?.content.includes("await fetch(url, init)"));
assert.equal(generated.plan.target, "js.fetch");
assert.equal(generated.plan.transfers[0].steps[0].behavior, "url");
assert.equal(generated.plan.transfers[0].steps[0].capability, "native");
assert.equal(generated.support.level, "exact");

const generatedFromIr = generateCodeFromIr(shellOutput.ir, { target: "js.fetch" });
assert.equal(generatedFromIr.schemaVersion, "curl-generate-output/v2");
assert.equal(generatedFromIr.target, "js.fetch");
assert(generatedFromIr.files[0]?.content.includes("await fetch(url, init)"));

const browserGeneratedFromIr = browserEntry.generateCodeFromIr(shellOutput.ir, {
  target: "js.fetch",
});
assert.equal(browserGeneratedFromIr.target, "js.fetch");
assert(browserGeneratedFromIr.files[0]?.content.includes("await fetch(url, init)"));

const browserGenerated = await browserEntry.generateCode(shellOutput.ir, { target: "js.fetch" });
assert.equal(browserGenerated.target, "js.fetch");
assert(browserGenerated.files[0]?.content.includes("await fetch(url, init)"));

const pythonGenerated = await generateCode(shellOutput, { target: "python.requests" });
assert.equal(pythonGenerated.target, "python.requests");
assert.equal(pythonGenerated.files[0]?.path, "main.py");
assert(pythonGenerated.files[0]?.content.includes("requests.Session()"));

const httpxGenerated = await generateCode(shellOutput, { target: "python.httpx" });
assert.equal(httpxGenerated.target, "python.httpx");
assert.equal(httpxGenerated.files[0]?.path, "main.py");
assert(httpxGenerated.files[0]?.content.includes("httpx.Client("));

const undiciGenerated = await generateCode(shellOutput, { target: "js.undici" });
assert.equal(undiciGenerated.target, "js.undici");
assert.equal(undiciGenerated.files[0]?.path, "main.mjs");
assert(undiciGenerated.files[0]?.content.includes("undici"));

const axiosGenerated = await generateCode(shellOutput, { target: "js.axios" });
assert.equal(axiosGenerated.target, "js.axios");
assert.equal(axiosGenerated.files[0]?.path, "main.mjs");
assert(axiosGenerated.files[0]?.content.includes("axios.request"));

const goGenerated = await generateCode(shellOutput, { target: "go.net_http" });
assert.equal(goGenerated.target, "go.net_http");
assert.equal(goGenerated.files[0]?.path, "main.go");
assert(goGenerated.files[0]?.content.includes("http.NewRequestWithContext"));

const rustGenerated = await generateCode(shellOutput, { target: "rust.reqwest" });
assert.equal(rustGenerated.target, "rust.reqwest");
assert(rustGenerated.files.some((file) => file.path === "Cargo.toml"));
assert(rustGenerated.files.some((file) => file.path === "src/main.rs"));

const ftpOutput = await parseCurl(["curl", "ftp.example.com/README"]);
assert.equal(ftpOutput.ir?.groups?.[0]?.transfers?.[0]?.url, "ftp://ftp.example.com/README");
const ftpFetchGenerated = await generateCode(ftpOutput, { target: "js.fetch" });
assert.equal(ftpFetchGenerated.support.level, "unsupported");
assert(
  ftpFetchGenerated.diagnostics.some(
    (diagnostic) => diagnostic.code === "E_TARGET_URL_SCHEME_UNSUPPORTED",
  ),
);
assert.equal(ftpFetchGenerated.files[0]?.content.includes("fetch("), false);

const libcurlOptionOutput = await parseCurl(
  ["curl", "--libcurl", "out.c", "https://example.com"],
  { parseMode: "diagnostic" },
);
assert.equal(libcurlOptionOutput.ok, false);
assert(
  libcurlOptionOutput.errors.some((error) =>
    error.code === "E_PARSE_HOST_DEPENDENCY_UNSUPPORTED" && error.option === "--libcurl"
  ),
);

const browserSource = await readFile("packages/node/dist/browser.js", "utf8");
assert.equal(browserSource.includes("node:fs"), false);
assert.equal(browserSource.includes("node:wasi"), false);

const cli = await execFileAsync("node", ["packages/node/dist/cli.js", "targets"], {
  cwd: ".",
});
assert(JSON.parse(cli.stdout).some((item) => item.target === "js.fetch"));

const esmImport = await execFileAsync(
  "node",
  [
    "--input-type=module",
    "-e",
    "import { generateCodeFromIr, listTargets } from '@hellodword/curl-parser'; import { createParser } from '@hellodword/curl-parser/browser'; console.log(listTargets().includes('js.fetch') && typeof createParser === 'function' && typeof generateCodeFromIr === 'function');",
  ],
  { cwd: "packages/node" },
);
assert.equal(esmImport.stdout.trim(), "true");

const { stdout } = await execFileAsync("npm", ["pack", "--dry-run", "--json"], {
  cwd: "packages/node",
});
const [pack] = JSON.parse(stdout);
const files = new Set(pack.files.map((file) => file.path));
assert(pack.size < 256 * 1024 * 1024);

for (const required of [
  "dist/node.js",
  "dist/browser.js",
  "dist/index.d.ts",
  "dist/generator/index.js",
  "dist/generator/renderers/index.js",
  "dist/cli.js",
  "schemas/parse-input.v2.schema.json",
  "schemas/curl-ir.v2.schema.json",
  "schemas/target-capabilities.v2.schema.json",
  "wasm/curl_parser.wasm",
  "README.md",
  "LICENSE",
]) {
  assert(files.has(required), `npm pack missing ${required}`);
}
