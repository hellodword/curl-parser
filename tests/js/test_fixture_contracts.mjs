import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { promisify } from "node:util";

import { generateCode, listTargets, parseCurl, parseShellCommand } from "../../packages/node/dist/node.js";

const execFileAsync = promisify(execFile);

async function fixture(path) {
  const payload = JSON.parse(await readFile(path, "utf8"));
  assert.equal(payload.schemaVersion, "curl-parser-fixtures/v1", path);
  assert(Array.isArray(payload.cases), path);
  return payload.cases;
}

function firstTransfer(parsed) {
  assert.equal(parsed.ok, true);
  const transfer = parsed.ir?.groups?.[0]?.transfers?.[0];
  assert(transfer, "missing first transfer");
  return transfer;
}

function assertIrExpectation(transfer, expected, name) {
  const effective = transfer.effective;
  assert.equal(transfer.url, expected.url, name);
  if (Object.hasOwn(expected, "rawUrl")) {
    assert.equal(transfer.rawUrl, expected.rawUrl, name);
  }
  if (expected.urlResolution) {
    assert.equal(transfer.urlResolution?.scheme, expected.urlResolution.scheme, name);
    assert.equal(transfer.urlResolution?.source, expected.urlResolution.source, name);
    assert.equal(transfer.urlResolution?.normalized, expected.urlResolution.normalized, name);
  }
  assert.equal(effective.method.value, expected.method, name);
  if (expected.header) {
    assert(
      effective.headers.some(
        (header) =>
          header.name === expected.header.name && header.value === expected.header.value,
      ),
    );
  }
  if (expected.body) {
    assert.equal(effective.body?.kind, expected.body.kind, name);
    assert.equal(effective.body?.value, expected.body.value, name);
  }
  if (expected.proxy) {
    assert.equal(effective.proxy?.url, expected.proxy, name);
  }
  if (Object.hasOwn(expected, "tlsVerify")) {
    assert.equal(effective.tls?.verify, expected.tlsVerify, name);
  }
  if (expected.cookie) {
    assert(effective.cookies.some((cookie) => cookie.value === expected.cookie));
  }
  if (Object.hasOwn(expected, "authSensitive")) {
    assert.equal(effective.auth?.sensitive, expected.authSensitive, name);
  }
}

async function generatedFor(target, argv) {
  const parsed = await parseCurl(argv);
  return generateCode(parsed, { target });
}

function assertGeneratedShape(output, testCase) {
  const paths = new Set(output.files.map((file) => file.path));
  for (const path of testCase.files ?? []) {
    assert(paths.has(path), `${testCase.name} missing ${path}`);
  }
  const allContent = output.files.map((file) => file.content).join("\n");
  for (const snippet of testCase.contains ?? []) {
    assert(allContent.includes(snippet), `${testCase.name} missing ${snippet}`);
  }
  if (testCase.support) {
    assert.equal(output.support.level, testCase.support, testCase.name);
  }
}

async function runNodeFetchReplay(output, testCase) {
  const file = output.files.find((candidate) => candidate.path === "main.js");
  assert(file, "missing main.js");
  const captured = await new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("ok");
        server.close();
        resolve({
          method: request.method,
          url: request.url,
          headers: request.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", async () => {
      try {
        const address = server.address();
        assert(address && typeof address === "object");
        const url = `http://127.0.0.1:${address.port}${testCase.expect.url}`;
        const source = file.content.replace("http://127.0.0.1:1/replay", url);
        await execFileAsync("node", ["--input-type=module", "-e", source]);
      } catch (error) {
        server.close();
        reject(error);
      }
    });
  });

  assert.equal(captured.method, testCase.expect.method);
  assert.equal(captured.url, testCase.expect.url);
  assert.equal(captured.body, testCase.expect.body);
  for (const [name, value] of Object.entries(testCase.expect.headers ?? {})) {
    assert.equal(captured.headers[name], value);
  }
}

async function testShellFixtures() {
  for (const testCase of await fixture("fixtures/parse/shell-dialects.json")) {
    const result = parseShellCommand(testCase.command, {
      shellDialect: testCase.shellDialect,
    });
    assert.deepEqual(result.input.argv, testCase.argv, testCase.name);
    assert.equal(result.input.argvSpans.length, testCase.argv.length, testCase.name);
  }
}

async function testCanonicalIrFixtures() {
  for (const testCase of await fixture("fixtures/ir/canonical.json")) {
    const parsed = await parseCurl(testCase.argv);
    assertIrExpectation(firstTransfer(parsed), testCase.expected, testCase.name);
  }
}

async function testCodegenFixtures() {
  const targets = new Set(listTargets());
  for (const testCase of await fixture("fixtures/codegen/golden.json")) {
    assert(targets.has(testCase.target), testCase.target);
    assertGeneratedShape(await generatedFor(testCase.target, testCase.argv), testCase);
  }
}

async function testReplayFixtures() {
  for (const testCase of await fixture("fixtures/replay/http.json")) {
    const output = await generatedFor(testCase.target, testCase.argv);
    assertGeneratedShape(output, testCase);
    if (testCase.execute === "node-fetch") {
      await runNodeFetchReplay(output, testCase);
    }
  }
}

async function testSupportFixtures() {
  for (const testCase of await fixture("fixtures/replay/support.json")) {
    const output = await generatedFor(testCase.target, testCase.argv);
    assert.equal(output.support.level, testCase.support, testCase.name);
    if (testCase.diagnostic) {
      assert(
        output.diagnostics.some((diagnostic) => diagnostic.code === testCase.diagnostic),
        testCase.name,
      );
    }
  }
}

await testShellFixtures();
await testCanonicalIrFixtures();
await testCodegenFixtures();
await testReplayFixtures();
await testSupportFixtures();
console.log("fixture contracts ok");
