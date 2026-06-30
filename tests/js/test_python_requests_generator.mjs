import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { generateCode, parseCurl } from "../../packages/node/dist/node.js";

const execFileAsync = promisify(execFile);
const outDir = "build/python-requests-generator";

function file(output) {
  const item = output.files.find((candidate) => candidate.path === "main.py");
  assert(item, "missing main.py");
  assert.equal(item.role, "main");
  return item;
}

async function generate(argv, parseOptions = {}, target = "python.requests", generateOptions = {}) {
  const parsed = await parseCurl(argv, parseOptions);
  const output = await generateCode(parsed, { target, options: generateOptions });
  assert.equal(output.target, target);
  assert.equal(output.plan.target, target);
  return { output, source: file(output).content };
}

async function compilePython(name, source) {
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, `${name}.py`);
  await writeFile(path, source, "utf8");
  await execFileAsync("python", ["-m", "py_compile", path]);
}

async function testGoldenShapes() {
  const get = await generate(["curl", "https://example.com"]);
  assert(get.source.includes("requests.Session()"));
  assert(get.source.includes('session.request("GET"'));
  await compilePython("get", get.source);

  const httpx = await generate(["curl", "--http2", "https://example.com"], {}, "python.httpx");
  assert.equal(httpx.output.support.level, "exact");
  assert(httpx.source.includes("import httpx"));
  assert(httpx.source.includes("httpx.Client(http2=True)"));
  assert(httpx.source.includes('session.request("GET"'));
  await compilePython("httpx-get", httpx.source);

  const post = await generate([
    "curl",
    "-H",
    "x-test: yes",
    "--data-raw",
    "hello",
    "https://example.com",
  ]);
  assert(post.source.includes('"x-test": "yes"'));
  assert(post.source.includes('request_kwargs["data"] = "hello"'));
  assert(post.source.includes('session.request("POST"'));
  await compilePython("post", post.source);

  const json = await generate(["curl", "--json", "{\"a\":1}", "https://example.com"]);
  assert(json.source.includes('request_kwargs["json"] = {"a": 1}'));
  assert(json.source.includes('session.request("POST"'));
  await compilePython("json", json.source);

  const multipart = await generate(["curl", "-F", "a=b", "https://example.com"]);
  assert(multipart.source.includes('request_kwargs["files"]'));
  assert(multipart.source.includes('"a": (None, "b")'));
  await compilePython("multipart", multipart.source);

  const multi = await generate(["curl", "https://a.test", "--next", "https://b.test"]);
  assert(multi.source.indexOf("https://a.test") < multi.source.indexOf("https://b.test"));
  assert(multi.source.includes('session.request("GET", url_0'));
  assert(multi.source.includes('session.request("GET", url_1'));
  await compilePython("multi", multi.source);

  const digest = await generate([
    "curl",
    "--digest",
    "-u",
    "alice:secret",
    "https://example.com",
  ]);
  assert(digest.source.includes("requests.auth.HTTPDigestAuth"));
  await compilePython("digest", digest.source);

  const insecureTls = await generate(["curl", "-k", "https://example.com"]);
  assert(insecureTls.source.includes('request_kwargs["verify"] = False'));
  await compilePython("insecure-tls", insecureTls.source);

  const timeout = await generate([
    "curl",
    "--connect-timeout",
    "2.5",
    "--max-time",
    "5",
    "https://example.com",
  ]);
  assert(timeout.source.includes('request_kwargs["timeout"] = (2.5, 5)'));
  await compilePython("timeout", timeout.source);
}

async function testHttpxFeatures() {
  const asyncHttpx = await generate(
    ["curl", "https://example.com"],
    {},
    "python.httpx",
    { style: "async" },
  );
  assert(asyncHttpx.source.includes("import asyncio"));
  assert(asyncHttpx.source.includes("async with httpx.AsyncClient("));
  assert(asyncHttpx.source.includes('response = await session.request("GET"'));
  assert(asyncHttpx.source.includes("asyncio.run(main())"));
  await compilePython("httpx-async", asyncHttpx.source);

  const http3 = await generate(["curl", "--http3", "https://example.com"], {}, "python.httpx");
  assert.equal(http3.output.support.level, "unsupported");
  assert(http3.output.diagnostics.some((item) => item.code === "E_TARGET_UNSUPPORTED"));
  assert(http3.source.includes("raise SystemExit"));
  assert.equal(http3.source.includes("httpx.Client"), false);
  await compilePython("httpx-unsupported-http3", http3.source);
}

async function testDiagnostics() {
  const blocked = await generate(["curl", "--data", "@missing.txt", "https://example.com"]);
  assert.equal(blocked.output.support.level, "requires-runtime-helper");
  assert(blocked.source.includes('Path("missing.txt").read_bytes()'));

  const jsonFile = await generate(["curl", "--json", "@payload.json", "https://example.com"]);
  assert(jsonFile.source.includes('headers.setdefault("content-type", "application/json")'));
  assert(jsonFile.source.includes('request_kwargs["data"] = Path("payload.json").read_bytes()'));

  const formFile = await generate(["curl", "-F", "file=@secret.txt", "https://example.com"]);
  assert(formFile.source.includes('"file": ("secret.txt", Path("secret.txt").read_bytes())'));

  const headerFile = await generate(["curl", "-H", "@headers.txt", "https://example.com"]);
  assert(headerFile.source.includes("parse_header_lines"));
  assert(headerFile.source.includes('Path("headers.txt").read_text()'));

  const http2 = await generate(["curl", "--http2", "https://example.com"]);
  assert.equal(http2.output.support.level, "lossy");
  assert(http2.output.diagnostics.some((item) => item.code === "W_TARGET_LOSSY"));

  const ftp = await generate(["curl", "ftp.example.com/README"]);
  assert.equal(ftp.output.support.level, "unsupported");
  assert(ftp.output.diagnostics.some((item) => item.code === "E_TARGET_URL_SCHEME_UNSUPPORTED"));
  assert(ftp.source.includes("raise SystemExit"));
  assert.equal(ftp.source.includes("session.request"), false);
  await compilePython("unsupported-ftp", ftp.source);

  const cookieJar = await generate(["curl", "-b", "cookies.txt", "https://example.com"]);
  assert(cookieJar.source.includes("load_cookie_jar"));
  assert.equal(cookieJar.output.support.level, "requires-runtime-helper");
  assert(
    cookieJar.output.support.items.some(
      (item) => item.behavior === "cookies.jar" && item.level === "requires-runtime-helper",
    ),
  );
}

async function testExternalRefModes() {
  const forbid = await generate(
    ["curl", "--data", "@payload.txt", "https://example.com"],
    {},
    "python.requests",
    { runtimeHelpers: "forbid" },
  );
  assert.equal(forbid.output.support.level, "unsupported");
  assert(
    forbid.output.diagnostics.some(
      (item) => item.code === "E_TARGET_EXTERNAL_REF_UNSUPPORTED",
    ),
  );
  assert(forbid.source.includes("raise SystemExit"));
  assert.equal(forbid.source.includes('Path("payload.txt").read_bytes()'), false);
  await compilePython("external-forbid", forbid.source);

  const inline = await generate(
    ["curl", "--data", "@payload.txt", "https://example.com"],
    {},
    "python.requests",
    { runtimeHelpers: "inline" },
  );
  assert.equal(inline.output.support.level, "requires-runtime-helper");
  assert(inline.source.includes('load_external_bytes("external-0")'));
  assert.equal(inline.source.includes('Path("payload.txt").read_bytes()'), false);
  await compilePython("external-inline", inline.source);
}

async function testSnapshotDir(dir, defaultTarget) {
  const inputs = (await readdir(dir)).filter((name) => name.endsWith(".input.json")).sort();
  assert(inputs.length > 0, `missing ${defaultTarget} generator snapshots`);

  for (const inputName of inputs) {
    const base = inputName.slice(0, -".input.json".length);
    const payload = JSON.parse(await readFile(join(dir, inputName), "utf8"));
    assert.equal(payload.schemaVersion, "curl-parser-generator-fixture/v1", inputName);
    const { output, source } = await generate(
      payload.argv,
      {},
      payload.target ?? defaultTarget,
      payload.options ?? {},
    );

    assert.equal(output.support.level, payload.support, base);
    if (payload.diagnostic) {
      assert(
        output.diagnostics.some((item) => item.code === payload.diagnostic),
        `${base} diagnostic ${payload.diagnostic}`,
      );
    }
    for (const snippet of payload.contains ?? []) {
      assert(source.includes(snippet), `${base} missing ${snippet}`);
    }
    for (const snippet of payload.notContains ?? []) {
      assert.equal(source.includes(snippet), false, `${base} contains ${snippet}`);
    }
    assert.equal(source, await readFile(join(dir, `${base}.main.py`), "utf8"), base);
    assert.equal(/libcurl/iu.test(source), false, base);
    if (base === "unsupported-http2") {
      assert.equal(/http2/iu.test(source), false, base);
    }
    await compilePython(`snapshot-${base}`, source);
  }
}

async function testSnapshots() {
  await testSnapshotDir("fixtures/generator/python.requests", "python.requests");
  await testSnapshotDir("fixtures/generator/python.httpx", "python.httpx");
}

await testGoldenShapes();
await testHttpxFeatures();
await testDiagnostics();
await testExternalRefModes();
await testSnapshots();
console.log("python requests generator ok");
