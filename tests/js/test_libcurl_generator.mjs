import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import { join } from "node:path";
import { promisify } from "node:util";

import { generateCode, parseCurl } from "../../packages/node/dist/node.js";

const execFileAsync = promisify(execFile);
const outDir = "build/libcurl-generator";
const curlSource = JSON.parse(await readFile("config/curl-source.json", "utf8"));
const includeDir = `third_party/curl/${curlSource.tag}/include`;
const cc = (process.env.CC ?? "cc").trim().split(/\s+/);

function file(output) {
  const item = output.files.find((candidate) => candidate.path === "main.c");
  assert(item, "missing main.c");
  assert.equal(item.role, "main");
  return item;
}

async function generate(argv) {
  const parsed = await parseCurl(argv);
  const output = await generateCode(parsed, { target: "c.libcurl" });
  assert.equal(output.target, "c.libcurl");
  assert.equal(output.plan.target, "c.libcurl");
  return file(output).content;
}

async function compileSyntax(name, source) {
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, `${name}.c`);
  const objectPath = join(outDir, `${name}.o`);
  await writeFile(path, source, "utf8");
  await execFileAsync(cc[0], [
    ...cc.slice(1),
    "-std=c99",
    "-c",
    "-I",
    includeDir,
    path,
    "-o",
    objectPath,
  ]);
}

async function testCompileCases() {
  const getSource = await generate(["curl", "https://example.com"]);
  assert(getSource.includes("CURLOPT_URL"));
  await compileSyntax("get", getSource);

  const ftpSource = await generate(["curl", "ftp.example.com/README"]);
  assert(ftpSource.includes("ftp://ftp.example.com/README"));
  await compileSyntax("ftp", ftpSource);

  const postSource = await generate(["curl", "--data-raw", "hello", "https://example.com"]);
  assert(postSource.includes("CURLOPT_POSTFIELDS"));
  assert(postSource.includes('"hello"'));
  await compileSyntax("post", postSource);

  const multipartSource = await generate(["curl", "-F", "a=b", "https://example.com"]);
  assert(multipartSource.includes("curl_mime_init"));
  assert(multipartSource.includes("CURLOPT_MIMEPOST"));
  await compileSyntax("multipart", multipartSource);

  const externalMultipartSource = await generate(["curl", "-F", "file=@secret.txt", "https://example.com"]);
  assert(externalMultipartSource.includes('curl_mime_filedata(part, "secret.txt")'));
  await compileSyntax("external-multipart", externalMultipartSource);

  const externalFieldSource = await generate(["curl", "-F", "field=<field.txt", "https://example.com"]);
  assert(externalFieldSource.includes('read_file_to_memory("field.txt"'));
  assert(externalFieldSource.includes("curl_mime_data(part, post_data, post_data_size)"));
  await compileSyntax("external-field", externalFieldSource);

  const externalJsonSource = await generate(["curl", "--json", "@payload.json", "https://example.com"]);
  assert(externalJsonSource.includes('read_file_to_memory("payload.json"'));
  assert(externalJsonSource.includes('"Content-Type: application/json"'));
  await compileSyntax("external-json", externalJsonSource);

  const externalHeadersSource = await generate(["curl", "-H", "@headers.txt", "https://example.com"]);
  assert(externalHeadersSource.includes('read_file_to_memory("headers.txt"'));
  assert(externalHeadersSource.includes("append_header_lines(&headers"));
  await compileSyntax("external-headers", externalHeadersSource);

  const optionsSource = await generate([
    "curl",
    "-H",
    "x-test: yes",
    "-b",
    "a=b",
    "-u",
    "user:pass",
    "--proxy",
    "http://proxy:8080",
    "-k",
    "-L",
    "--max-time",
    "5",
    "--connect-timeout",
    "2",
    "https://example.com",
  ]);
  for (const expected of [
    "CURLOPT_HTTPHEADER",
    "CURLOPT_COOKIE",
    "CURLOPT_USERPWD",
    "CURLOPT_PROXY",
    "CURLOPT_SSL_VERIFYPEER",
    "CURLOPT_FOLLOWLOCATION",
    "CURLOPT_TIMEOUT_MS",
    "CURLOPT_CONNECTTIMEOUT_MS",
  ]) {
    assert(optionsSource.includes(expected), `missing ${expected}`);
  }
  await compileSyntax("options", optionsSource);

  const multiSource = await generate(["curl", "https://a.test", "--next", "https://b.test"]);
  assert(multiSource.indexOf("https://a.test") < multiSource.indexOf("https://b.test"));
  assert(multiSource.includes("perform_request_0"));
  assert(multiSource.includes("perform_request_1"));
  await compileSyntax("multi", multiSource);
}

async function captureCurlRequest(argv) {
  const requestPromise = new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        response.writeHead(204);
        response.end();
        server.close();
        resolve({
          method: request.method,
          url: request.url,
          headers: request.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    server.listen(0, "127.0.0.1", async () => {
      const address = server.address();
      assert(address && typeof address === "object");
      const url = `http://127.0.0.1:${address.port}/capture`;
      await execFileAsync("curl", [...argv, url]);
    });
  });
  return requestPromise;
}

async function commandExists(name) {
  try {
    await execFileAsync(name, ["--version"]);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function testReplayIntent() {
  if (!(await commandExists("curl"))) {
    console.log("curl binary missing; replay server comparison skipped");
    return;
  }

  const curlRequest = await captureCurlRequest(["-sS", "-H", "x-test: yes", "--data-raw", "hello"]);
  assert.equal(curlRequest.method, "POST");
  assert.equal(curlRequest.url, "/capture");
  assert.equal(curlRequest.headers["x-test"], "yes");
  assert.equal(curlRequest.body, "hello");

  const source = await generate([
    "curl",
    "-H",
    "x-test: yes",
    "--data-raw",
    "hello",
    "http://127.0.0.1/capture",
  ]);
  assert(source.includes('"x-test: yes"'));
  assert(source.includes('"hello"'));
  assert(source.includes("CURLOPT_POSTFIELDS"));
}

await testCompileCases();
await testReplayIntent();
console.log("libcurl generator ok");
