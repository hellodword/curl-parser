import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import http from "node:http";
import { promisify } from "node:util";

import { generateCode, listTargets, parseCurl, parseShellCommand } from "../../packages/node/dist/node.js";

const execFileAsync = promisify(execFile);
const stableDiagnosticCode = /^(E|W|I)_[A-Z0-9_]+$|^(parse-error|option-not-available|protocol-not-available|feature-not-available)$/;

async function fixture(path) {
  const payload = JSON.parse(await readFile(path, "utf8"));
  assert.equal(payload.schemaVersion, "curl-parser-fixtures/v1", path);
  assert(Array.isArray(payload.cases), path);
  return payload.cases;
}

async function externalRefKinds() {
  const schema = JSON.parse(await readFile("schemas/curl-ir.v2.schema.json", "utf8"));
  return new Set(schema.$defs.externalRef.properties.kind.enum);
}

function firstTransfer(parsed, expectedOk = true) {
  assert.equal(parsed.ok, expectedOk);
  const transfer = parsed.ir?.groups?.[0]?.transfers?.[0];
  assert(transfer, "missing first transfer");
  return transfer;
}

function transfers(parsed) {
  return parsed.ir?.groups?.flatMap((group) => group.transfers ?? []) ?? [];
}

function assertPartial(actual, expected, path) {
  if (Array.isArray(expected)) {
    assert(Array.isArray(actual), `${path} must be array`);
    assert(actual.length >= expected.length, `${path} length`);
    expected.forEach((value, index) => assertPartial(actual[index], value, `${path}[${index}]`));
    return;
  }
  if (expected && typeof expected === "object") {
    assert(actual && typeof actual === "object", `${path} must be object`);
    for (const [key, value] of Object.entries(expected)) {
      assertPartial(actual[key], value, `${path}.${key}`);
    }
    return;
  }
  assert.deepEqual(actual, expected, path);
}

function assertDiagnosticContracts(items, name) {
  assert(Array.isArray(items), `${name}.diagnostics`);
  for (const diagnostic of items) {
    assert.equal(typeof diagnostic.code, "string", `${name}.diagnostic.code`);
    assert(stableDiagnosticCode.test(diagnostic.code), `${name}.diagnostic.code ${diagnostic.code}`);
  }
}

function assertExternalRefContracts(parsed, allowedKinds, name) {
  const refs = parsed.ir?.externalRefs ?? [];
  const refIds = new Set();
  for (const ref of refs) {
    assert.equal(typeof ref.id, "string", `${name}.externalRefs.id`);
    assert(allowedKinds.has(ref.kind), `${name}.externalRefs.kind ${ref.kind}`);
    refIds.add(ref.id);
  }

  function walk(value, path) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      if (key.endsWith("RefId") && typeof item === "string") {
        assert(refIds.has(item), `${path}.${key} resolves`);
      }
      walk(item, `${path}.${key}`);
    }
  }

  walk(parsed.ir, `${name}.ir`);
}

function assertParseOutputContracts(parsed, allowedKinds, name) {
  assert.equal(parsed.schemaVersion, "curl-parse-output/v2", name);
  assertDiagnosticContracts(parsed.diagnostics, name);
  assertDiagnosticContracts(parsed.errors, name);
  if (parsed.ir) {
    assert.equal(parsed.ir.schemaVersion, "curl-ir/v2", name);
    assertExternalRefContracts(parsed, allowedKinds, name);
    assertDiagnosticContracts(parsed.ir.diagnostics, `${name}.ir`);
  }
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

async function testDomainFixtures() {
  const allowedKinds = await externalRefKinds();
  const entries = await readdir("fixtures/parse", { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dir = `fixtures/parse/${entry.name}`;
    const files = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
    for (const file of files) {
      for (const testCase of await fixture(`${dir}/${file}`)) {
        const parsed = await parseCurl(testCase.argv);
        assertParseOutputContracts(parsed, allowedKinds, testCase.name);
        if (Object.hasOwn(testCase.expected ?? {}, "ok")) {
          assert.equal(parsed.ok, testCase.expected.ok, testCase.name);
        }
        if (testCase.expected?.errors) {
          assertPartial(parsed.errors, testCase.expected.errors, `${testCase.name}.errors`);
        }
        if (testCase.expected?.externalRefs) {
          assertPartial(
            parsed.ir?.externalRefs,
            testCase.expected.externalRefs,
            `${testCase.name}.externalRefs`,
          );
        }
        if (testCase.expected?.noTransfers) {
          assert.equal(transfers(parsed).length, 0, `${testCase.name}.transfers`);
          continue;
        }
        const transfer = firstTransfer(parsed, testCase.expected?.ok ?? true);
        if (testCase.expected?.effective) {
          assertPartial(
            transfer.effective,
            testCase.expected.effective,
            `${testCase.name}.effective`,
          );
        }
      }
    }
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
await testDomainFixtures();
await testCodegenFixtures();
await testReplayFixtures();
await testSupportFixtures();
console.log("fixture contracts ok");
