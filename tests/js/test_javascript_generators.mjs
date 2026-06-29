import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { generateCode, parseCurl } from "../../packages/node/dist/node.js";

const execFileAsync = promisify(execFile);
const outDir = "build/javascript-generators";

function file(output, path) {
  const item = output.files.find((candidate) => candidate.path === path);
  assert(item, `missing ${path}`);
  assert.equal(item.role, "main");
  return item;
}

async function generate(argv, target) {
  const parsed = await parseCurl(argv);
  const output = await generateCode(parsed, { target });
  assert.equal(output.target, target);
  assert.equal(output.plan.target, target);
  return output;
}

async function checkJavaScript(name, source) {
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, name);
  await writeFile(path, source, "utf8");
  await execFileAsync("node", ["--check", path]);
}

async function testFetchGenerator() {
  const getOutput = await generate(["curl", "https://example.com"], "js.fetch");
  const getSource = file(getOutput, "main.js").content;
  assert.equal(getOutput.support.level, "exact");
  assert(getSource.includes("await fetch(url, init)"));
  assert(!getSource.includes("undici"));
  assert(!getSource.includes("process."));
  await checkJavaScript("fetch-get.js", getSource);

  const postOutput = await generate(
    ["curl", "-H", "x-test: yes", "--data-raw", "hello", "https://example.com"],
    "js.fetch",
  );
  const postSource = file(postOutput, "main.js").content;
  assert(postSource.includes('["x-test", "yes"]'));
  assert(postSource.includes('body: "hello"'));
  await checkJavaScript("fetch-post.js", postSource);

  const multiOutput = await generate(
    ["curl", "https://a.test", "--next", "https://b.test"],
    "js.fetch",
  );
  const multiSource = file(multiOutput, "main.js").content;
  assert(multiSource.indexOf("https://a.test") < multiSource.indexOf("https://b.test"));
  assert(multiSource.includes("await fetch(url0, init0)"));
  assert(multiSource.includes("await fetch(url1, init1)"));
  await checkJavaScript("fetch-multi.js", multiSource);
}

async function testUndiciGenerator() {
  const output = await generate(
    ["curl", "--proxy", "http://proxy:8080", "-k", "https://example.com"],
    "js.undici",
  );
  const source = file(output, "main.mjs").content;
  assert(source.includes('from "undici"'));
  assert(source.includes("ProxyAgent"));
  assert(source.includes("request(url, options)"));
  await checkJavaScript("undici-proxy.mjs", source);

  const multi = await generate(["curl", "https://a.test", "--next", "https://b.test"], "js.undici");
  const multiSource = file(multi, "main.mjs").content;
  assert(multiSource.indexOf("https://a.test") < multiSource.indexOf("https://b.test"));
  assert(multiSource.includes("request(url0, options0)"));
  assert(multiSource.includes("request(url1, options1)"));
  await checkJavaScript("undici-multi.mjs", multiSource);

  const multipart = await generate(["curl", "-F", "file=@secret.txt", "https://example.com"], "js.undici");
  const multipartSource = file(multipart, "main.mjs").content;
  assert(multipartSource.includes("new FormData()"));
  assert(multipartSource.includes('new Blob([await readFile("secret.txt")])'));
  assert.equal(multipartSource.includes('body: await readFile("secret.txt")'), false);
  await checkJavaScript("undici-multipart-external.mjs", multipartSource);

  const json = await generate(["curl", "--json", "@payload.json", "https://example.com"], "js.undici");
  const jsonSource = file(json, "main.mjs").content;
  assert(jsonSource.includes('import { readFile } from "node:fs/promises";'));
  assert(jsonSource.includes('const headers = {"content-type":"application/json"};'));
  assert(jsonSource.includes('body: await readFile("payload.json")'));
  await checkJavaScript("undici-json-external.mjs", jsonSource);

  const headerFile = await generate(["curl", "-H", "@headers.txt", "https://example.com"], "js.undici");
  const headerSource = file(headerFile, "main.mjs").content;
  assert(headerSource.includes('await readFile("headers.txt", "utf8")'));
  assert(headerSource.includes("headers[line.slice(0, index)]"));
  await checkJavaScript("undici-header-external.mjs", headerSource);
}

async function testDuplicateHeaderWarning() {
  const output = await generate(
    ["curl", "-H", "x-test: one", "-H", "x-test: two", "https://example.com"],
    "js.fetch",
  );
  assert.equal(output.support.level, "lossy");
  assert(output.diagnostics.some((item) => item.code === "W_TARGET_LOSSY"));
}

async function testUnsupportedScheme() {
  for (const target of ["js.fetch", "js.undici"]) {
    const output = await generate(["curl", "ftp.example.com/README"], target);
    const source = file(output, target === "js.undici" ? "main.mjs" : "main.js").content;
    assert.equal(output.support.level, "unsupported");
    assert(output.diagnostics.some((item) => item.code === "E_TARGET_URL_SCHEME_UNSUPPORTED"));
    assert(source.includes("throw new Error"));
    assert.equal(source.includes("fetch("), false);
    assert.equal(source.includes("request("), false);
    await checkJavaScript(`unsupported-${target}.mjs`, source);
  }
}

async function testBrowserExternalRefUnsupported() {
  const output = await generate(["curl", "--data-binary", "@payload.txt", "https://example.com"], "js.fetch");
  const source = file(output, "main.js").content;
  assert.equal(output.support.level, "unsupported");
  assert(output.diagnostics.some((item) => item.code === "E_TARGET_EXTERNAL_REF_UNSUPPORTED"));
  assert(source.includes("throw new Error"));
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("readFile"), false);
  await checkJavaScript("fetch-external-unsupported.mjs", source);
}

await testFetchGenerator();
await testUndiciGenerator();
await testDuplicateHeaderWarning();
await testUnsupportedScheme();
await testBrowserExternalRefUnsupported();
console.log("javascript generators ok");
