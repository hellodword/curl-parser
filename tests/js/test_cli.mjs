import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cli = ["packages/node/dist/cli.js"];

async function runCli(args, options = {}) {
  return execFileAsync("node", [...cli, ...args], {
    cwd: ".",
    ...options,
  });
}

async function testParseJson() {
  const { stdout } = await runCli(["parse", "--json", "--", "curl", "https://example.com"]);
  const output = JSON.parse(stdout);
  assert.equal(output.schemaVersion, "curl-parse-output/v2");
  assert.equal(output.ok, true);
}

async function testGenerateCode() {
  const { stdout } = await runCli([
    "generate",
    "--target",
    "python.requests",
    "--",
    "curl",
    "https://example.com",
  ]);
  assert(stdout.includes("requests.Session()"));
  assert(stdout.includes("session.request"));
}

async function testPlanAndExplain() {
  const plan = await runCli([
    "plan",
    "--target",
    "js.fetch",
    "--",
    "curl",
    "--http3",
    "https://example.com",
  ]);
  assert.equal(JSON.parse(plan.stdout).target, "js.fetch");

  const explain = await runCli([
    "explain",
    "--target",
    "js.fetch",
    "--",
    "curl",
    "--http3",
    "https://example.com",
  ]);
  const payload = JSON.parse(explain.stdout);
  assert.equal(payload.target, "js.fetch");
  assert.equal(payload.support.level, "unsupported");
}

async function testTargetsAndSchema() {
  const targets = JSON.parse((await runCli(["targets"])).stdout);
  assert(targets.some((item) => item.target === "python.requests" && item.generator === true));

  const schemas = JSON.parse((await runCli(["schema"])).stdout);
  assert(schemas.schemas.includes("curlIrV2"));

  const direct = JSON.parse((await runCli(["targets"])).stdout);
  assert(direct.some((item) => item.target === "js.fetch"));
}

async function testFailOnWarning() {
  await assert.rejects(
    () =>
      runCli([
        "generate",
        "--target",
        "js.fetch",
        "--fail-on-warning",
        "--",
        "curl",
        "-H",
        "x-test: one",
        "-H",
        "x-test: two",
        "https://example.com",
      ]),
    (error) => {
      assert(error && typeof error === "object");
      assert.equal(error.code, 1);
      assert(String(error.stdout).includes("await fetch"));
      return true;
    },
  );
}

async function testExternalRefParse() {
  const { stdout } = await runCli([
    "parse",
    "--json",
    "--",
    "curl",
    "--data",
    "@missing.txt",
    "https://example.com",
  ]);
  const output = JSON.parse(stdout);
  assert.equal(output.ir.externalRefs[0].value, "missing.txt");
  assert.equal(output.ir.groups[0].transfers[0].effective.body.externalRefId, "external-0");
}

await testParseJson();
await testGenerateCode();
await testPlanAndExplain();
await testTargetsAndSchema();
await testFailOnWarning();
await testExternalRefParse();
console.log("cli ok");
