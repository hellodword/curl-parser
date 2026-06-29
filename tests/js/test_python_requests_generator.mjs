import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
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

async function generate(argv, parseOptions = {}) {
  const parsed = await parseCurl(argv, parseOptions);
  const output = await generateCode(parsed, { target: "python.requests" });
  assert.equal(output.target, "python.requests");
  assert.equal(output.plan.target, "python.requests");
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

await testGoldenShapes();
await testDiagnostics();
console.log("python requests generator ok");
