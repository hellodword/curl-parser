import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { generateCode, parseCurl } from "../../packages/node/dist/node.js";

const milestonePath = "fixtures/milestones/v0.1.0-alpha.json";
const milestone = JSON.parse(await readFile(milestonePath, "utf8"));
assert.equal(milestone.schemaVersion, "curl-parser-fixtures/v1");
assert.equal(milestone.parseCases.length, 10);
assert.equal(milestone.generateCases.length, 5);

for (const argv of milestone.parseCases) {
  const parsed = await parseCurl(argv);
  assert.equal(parsed.ok, true, argv.join(" "));
  assert.equal(parsed.ir?.schemaVersion, "curl-ir/v1", argv.join(" "));
  assert(parsed.ir?.groups?.[0]?.transfers?.[0]?.url, argv.join(" "));
}

for (const testCase of milestone.generateCases) {
  const parsed = await parseCurl(testCase.argv);
  const output = await generateCode(parsed, { target: testCase.target });
  assert.equal(output.target, testCase.target);
  assert(output.files.some((file) => file.path === testCase.file), testCase.target);
  assert(output.support.level, testCase.target);
}

const unsupportedParsed = await parseCurl(milestone.unsupportedCase.argv);
const unsupportedOutput = await generateCode(unsupportedParsed, {
  target: milestone.unsupportedCase.target,
});
assert(
  unsupportedOutput.diagnostics.some(
    (diagnostic) => diagnostic.code === milestone.unsupportedCase.diagnostic,
  ),
);

console.log("milestone alpha ok");
