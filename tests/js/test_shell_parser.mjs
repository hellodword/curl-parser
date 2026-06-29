#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  createParseInputFromArgv,
  parseShellCommand,
  supportedShellDialects,
} from "../../packages/node/dist/browser.js";

{
  const parsed = parseShellCommand("curl -H 'A: b' https://example.com", {
    shellDialect: "posix-sh",
  });
  assert.deepEqual(parsed.input.argv, ["curl", "-H", "A: b", "https://example.com"]);
  assert.equal(parsed.diagnostics.length, 0);
  assert.deepEqual(parsed.input.argvSpans[2], {
    source: "command",
    start: 8,
    end: 13,
  });
}

{
  const command = "curl --data-binary @payload.txt https://example.com";
  const parsed = parseShellCommand(command, { shellDialect: "bash" });
  const atFileIndex = parsed.input.argv.indexOf("@payload.txt");
  assert.equal(atFileIndex, 2);
  assert.deepEqual(parsed.input.argvSpans[atFileIndex], {
    source: "command",
    start: command.indexOf("@payload.txt"),
    end: command.indexOf("@payload.txt") + "@payload.txt".length,
  });
}

{
  const parsed = parseShellCommand("curl \\\n  -H 'A: 1' https://example.com", {
    shellDialect: "posix-sh",
  });
  assert.deepEqual(parsed.input.argv, ["curl", "-H", "A: 1", "https://example.com"]);
  assert.equal(parsed.diagnostics.length, 0);
}

{
  const parsed = parseShellCommand('curl -H "A: \\\n1" https://example.com', {
    shellDialect: "bash",
  });
  assert.deepEqual(parsed.input.argv, ["curl", "-H", "A: 1", "https://example.com"]);
  assert.equal(parsed.diagnostics.length, 0);
}

{
  const parsed = parseShellCommand("curl $(whoami)", { shellDialect: "zsh" });
  assert.deepEqual(parsed.input.argv, ["curl", "$(whoami)"]);
  assert.equal(parsed.diagnostics[0].code, "E_SHELL_UNSUPPORTED_COMMAND_SUBSTITUTION");
  assert.equal(parsed.diagnostics[0].severity, "error");
}

{
  const parsed = parseShellCommand("curl -H 'A: b' https://example.com", {
    shellDialect: "powershell",
  });
  assert.deepEqual(parsed.input.argv, ["curl", "-H", "A: b", "https://example.com"]);
}

{
  const parsed = parseShellCommand('curl -H "A: b" https://example.com', {
    shellDialect: "cmd",
  });
  assert.deepEqual(parsed.input.argv, ["curl", "-H", "A: b", "https://example.com"]);
}

{
  const input = createParseInputFromArgv(["curl", "https://example.com"], {
    argvSpans: [
      { source: "argv", argvIndex: 0, start: 0, end: 4 },
      { source: "argv", argvIndex: 1, start: 0, end: 19 },
    ],
  });
  assert.deepEqual(input.argvSpans[1], {
    source: "argv",
    argvIndex: 1,
    start: 0,
    end: 19,
  });
}

assert(supportedShellDialects.includes("fish"));
console.log("shell parser ok");
