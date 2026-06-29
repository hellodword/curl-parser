import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import ts from "../../apps/web-playground/node_modules/typescript/lib/typescript.js";
import {
  createBrowserWasiImports,
  createParser,
  parseShellCommand,
} from "../../packages/node/dist/browser.js";

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...await listFiles(path));
    } else {
      result.push(path);
    }
  }
  return result;
}

async function importExplainCommand() {
  const source = await readFile("apps/web-playground/src/explain-command.ts", "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);
}

for (const path of await listFiles("apps/web-playground/src")) {
  if (!/\.(ts|vue|css)$/u.test(path)) {
    continue;
  }
  const source = await readFile(path, "utf8");
  assert.equal(source.includes("node:"), false, `${path} must not import Node modules`);
  assert.equal(source.includes('type="file"'), false, `${path} must not expose file inputs`);
  assert.equal(source.includes("Virtual files"), false, `${path} must not expose virtual files`);
  assert.equal(source.includes("Diagnostics"), false, `${path} must not expose Diagnostics wording`);
}

const html = await readFile("apps/web-playground/index.html", "utf8");
assert(html.includes('<div id="app"></div>'));
assert(html.includes('/src/main.ts'));
assert.equal(html.includes("importmap"), false);

const packageJson = JSON.parse(await readFile("apps/web-playground/package.json", "utf8"));
assert.equal(packageJson.private, true);
assert.equal(packageJson.scripts.build, "vue-tsc --noEmit && vite build");
for (const dependency of ["vue", "naive-ui", "shiki", "lucide-vue-next"]) {
  assert(packageJson.dependencies[dependency], `missing runtime dependency ${dependency}`);
}
for (const dependency of ["vite", "typescript", "@vitejs/plugin-vue", "vue-tsc"]) {
  assert(packageJson.devDependencies[dependency], `missing dev dependency ${dependency}`);
}

const appSource = await readFile("apps/web-playground/src/App.vue", "utf8");
assert(appSource.includes('ref<Target>("js.fetch")'));
assert.equal(appSource.includes(">Run<"), false);
assert(appSource.includes(":ready=\"ready\""));
const resultTabs = await readFile("apps/web-playground/src/components/ResultTabs.vue", "utf8");
assert.equal(resultTabs.includes('tab="Argv"'), false);
assert(resultTabs.includes('name="details"'));
assert(resultTabs.includes('tab="Details"'));
assert.equal(resultTabs.includes('tab="Diagnostics"'), false);
assert(resultTabs.includes('v-if="ready"'));
assert(resultTabs.includes('default-value="details"'));
assert(
  resultTabs.indexOf('name="details"') < resultTabs.indexOf('name="code"') &&
    resultTabs.indexOf('name="code"') < resultTabs.indexOf('name="ir"'),
  "result tabs must be ordered Details, Code, IR",
);

const detailsPanel = await readFile("apps/web-playground/src/components/DetailsPanel.vue", "utf8");
assert(detailsPanel.includes("<h2>Messages</h2>"));
assert(detailsPanel.includes("<h2>External refs</h2>"));
assert.equal(detailsPanel.includes("No diagnostics"), false);

const parserClient = await readFile("apps/web-playground/src/parser-client.ts", "utf8");
assert(parserClient.includes("../../../dist/curl_parser.wasm?url"));
assert.equal(parserClient.includes("defaultPolicy"), false);
assert.equal(parserClient.includes("defaultOptions"), false);
assert(parserClient.includes("onInstantiate"));
assert(parserClient.includes("parseResult.ok && parseResult.ir"));

const wasmBytes = await readFile("dist/curl_parser.wasm");
const wasi = createBrowserWasiImports();
const parser = await createParser({
  wasmBytes,
  imports: wasi.imports,
  onInstantiate: wasi.setInstance,
});
const { explainCommand } = await importExplainCommand();

try {
  const shell = parseShellCommand("curl -H 'x-test: yes' https://example.com", {
    shellDialect: "posix-sh",
    parseMode: "diagnostic",
  });
  assert.equal(shell.input.argv?.[0], "curl");
  assert.equal(shell.input.argvSpans?.length, shell.input.argv?.length);

  const parsed = await parser.parseCurl(shell.input);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.ir?.schemaVersion, "curl-ir/v1");

  const generated = await parser.generateCode(parsed, { target: "js.fetch" });
  assert.equal(generated.target, "js.fetch");
  assert(generated.files[0]?.content.includes("await fetch(url, init)"));

  const bareDashShell = parseShellCommand("curl - --json '{\"name\":\"demo\"}' https://api.example.com/widgets", {
    shellDialect: "posix-sh",
    parseMode: "diagnostic",
  });
  const bareDashParsed = await parser.parseCurl(bareDashShell.input);
  assert.equal(bareDashParsed.ok, false);
  assert.equal(
    bareDashParsed.errors?.some((error) => error.code === "parse-error" && error.detail === "is unknown"),
    true,
  );
  const bareDashGenerated = await parser.generateCode(bareDashParsed, { target: "js.fetch" });
  assert(bareDashGenerated.files.length > 0);

  const bundledShell = parseShellCommand("curl -vfL example.com", {
    shellDialect: "posix-sh",
    parseMode: "diagnostic",
  });
  const bundledParsed = await parser.parseCurl(bundledShell.input);
  const explanations = explainCommand(bundledShell, bundledParsed);
  for (const [shortFlag, canonical] of [
    ["-v", "--verbose"],
    ["-f", "--fail"],
    ["-L", "--location"],
  ]) {
    const row = explanations.find((item) => item.displayToken === shortFlag);
    assert(row, `missing explanation for ${shortFlag}`);
    assert.equal(row.canonical, canonical);
    assert.equal(row.sourceToken, "-vfL");
  }

  const implicitUrl = await parser.parseCurl(["curl", "example.com"]);
  const implicitTransfer = implicitUrl.ir?.groups?.[0]?.transfers?.[0];
  assert.equal(implicitTransfer?.url, "http://example.com");
  assert.equal(implicitTransfer?.rawUrl, "example.com");
  assert.equal(implicitTransfer?.urlResolution?.source, "curl-default");

  const protoDefaultUrl = await parser.parseCurl(["curl", "--proto-default", "https", "example.com"]);
  const protoDefaultTransfer = protoDefaultUrl.ir?.groups?.[0]?.transfers?.[0];
  assert.equal(protoDefaultTransfer?.url, "https://example.com");
  assert.equal(protoDefaultTransfer?.urlResolution?.source, "proto-default");

  const ftpParsed = await parser.parseCurl(["curl", "ftp.example.com/README"]);
  const ftpTransfer = ftpParsed.ir?.groups?.[0]?.transfers?.[0];
  assert.equal(ftpTransfer?.url, "ftp://ftp.example.com/README");
  assert.equal(ftpTransfer?.urlResolution?.source, "hostname-prefix");
  const ftpFetch = await parser.generateCode(ftpParsed, { target: "js.fetch" });
  assert.equal(ftpFetch.support.level, "unsupported");
  assert.equal(
    ftpFetch.diagnostics.some((diagnostic) => diagnostic.code === "E_TARGET_URL_SCHEME_UNSUPPORTED"),
    true,
  );
  assert(ftpFetch.files[0]?.content.includes("throw new Error"));
  assert.equal(ftpFetch.files[0]?.content.includes("fetch("), false);
  const ftpLibcurl = await parser.generateCode(ftpParsed, { target: "c.libcurl" });
  assert.equal(ftpLibcurl.support.level, "exact");
  assert(ftpLibcurl.files[0]?.content.includes("ftp://ftp.example.com/README"));

  const externalRefShell = parseShellCommand("curl --data @missing.txt https://example.com", {
    shellDialect: "posix-sh",
    parseMode: "diagnostic",
  });
  const externalRefParsed = await parser.parseCurl(externalRefShell.input);
  assert.equal(externalRefParsed.ir?.externalRefs?.[0]?.value, "missing.txt");

  const unsupportedShell = parseShellCommand("curl --http3 https://example.com", {
    shellDialect: "posix-sh",
    parseMode: "diagnostic",
  });
  const unsupportedParsed = await parser.parseCurl(unsupportedShell.input);
  const unsupportedGenerated = await parser.generateCode(unsupportedParsed, {
    target: "js.fetch",
  });
  assert.equal(unsupportedGenerated.support.level, "unsupported");
} finally {
  parser.dispose();
}

console.log("web playground ok");
