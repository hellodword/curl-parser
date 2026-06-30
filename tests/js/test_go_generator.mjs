import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import { join } from "node:path";
import { promisify } from "node:util";

import { generateCode, parseCurl } from "../../packages/node/dist/node.js";

const execFileAsync = promisify(execFile);
const outDir = "build/go-generator";
const goEnv = { ...process.env, CGO_ENABLED: "0" };

function files(output) {
  assert(output.files.some((item) => item.path === "main.go"), "missing main.go");
  return output.files;
}

async function generate(argv, parseOptions = {}) {
  const parsed = await parseCurl(argv, parseOptions);
  const output = await generateCode(parsed, { target: "go.net_http" });
  assert.equal(output.target, "go.net_http");
  assert.equal(output.plan.target, "go.net_http");
  return { output, files: files(output) };
}

async function commandExists(name) {
  try {
    await execFileAsync(name, ["version"]);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function writeGoModule(name, generatedFiles) {
  const dir = join(outDir, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "go.mod"), "module generated\n\ngo 1.22\n", "utf8");
  for (const file of generatedFiles) {
    await writeFile(join(dir, file.path), file.content, "utf8");
  }
  return dir;
}

async function goTest(name, generatedFiles) {
  if (!(await commandExists("go"))) {
    console.log("go binary missing; generated Go compile skipped");
    return;
  }
  const dir = await writeGoModule(name, generatedFiles);
  await execFileAsync("go", ["test", "."], { cwd: dir, env: goEnv });
}

async function testCompileCases() {
  const get = await generate(["curl", "https://example.com"]);
  assert(get.files[0].content.includes("http.NewRequestWithContext"));
  assert(get.files[0].content.includes("http.ErrUseLastResponse"));
  await goTest("get", get.files);

  const redirects = await generate(["curl", "-L", "--max-redirs", "3", "https://example.com"]);
  assert(redirects.files[0].content.includes("if len(via) >= 3"));
  await goTest("redirects", redirects.files);

  const post = await generate(["curl", "--data-raw", "hello", "https://example.com"]);
  assert(post.files[0].content.includes('strings.NewReader("hello")'));
  await goTest("post", post.files);

  const multipart = await generate(["curl", "-F", "a=b", "https://example.com"]);
  assert(multipart.files[0].content.includes("multipart.NewWriter"));
  await goTest("multipart", multipart.files);

  const externalMultipart = await generate(["curl", "-F", "file=@secret.txt", "https://example.com"]);
  assert(externalMultipart.files[0].content.includes('os.ReadFile("secret.txt")'));
  assert(externalMultipart.files[0].content.includes("writer.CreateFormFile"));
  await goTest("external-multipart", externalMultipart.files);

  const externalField = await generate(["curl", "-F", "field=<field.txt", "https://example.com"]);
  assert(externalField.files[0].content.includes('os.ReadFile("field.txt")'));
  assert(externalField.files[0].content.includes("writer.WriteField"));
  await goTest("external-field", externalField.files);

  const externalJson = await generate(["curl", "--json", "@payload.json", "https://example.com"]);
  assert(externalJson.files[0].content.includes('os.ReadFile("payload.json")'));
  assert(externalJson.files[0].content.includes('req.Header.Set("Content-Type", "application/json")'));
  await goTest("external-json", externalJson.files);

  const externalHeaders = await generate(["curl", "-H", "@headers.txt", "https://example.com"]);
  assert(externalHeaders.files[0].content.includes('os.ReadFile("headers.txt")'));
  assert(externalHeaders.files[0].content.includes("req.Header.Add"));
  await goTest("external-headers", externalHeaders.files);

  const options = await generate([
    "curl",
    "--http2",
    "-k",
    "--proxy",
    "http://proxy:8080",
    "https://example.com",
  ]);
  const source = options.files[0].content;
  assert(source.includes("ForceAttemptHTTP2"));
  assert(source.includes("InsecureSkipVerify"));
  assert(source.includes("http.ProxyURL"));
  await goTest("options", options.files);

  const tls = await generate([
    "curl",
    "-k",
    "--cacert",
    "ca.pem",
    "--cert",
    "client.pem",
    "--key",
    "client.key",
    "https://example.com",
  ]);
  const tlsSource = tls.files.map((file) => file.content).join("\n");
  assert.equal(tls.output.support.level, "requires-runtime-helper");
  assert(tls.files.some((file) => file.path === "helper.go"));
  assert(tlsSource.includes("loadCAPool"));
  assert(tlsSource.includes("loadClientCertificate"));
  assert(tlsSource.includes("tlsConfig.RootCAs = rootCAs"));
  assert(tlsSource.includes("tlsConfig.Certificates = []tls.Certificate{clientCert}"));
  await goTest("tls-helper", tls.files);

  const dial = await generate([
    "curl",
    "--resolve",
    "example.com:443:203.0.113.10",
    "--interface",
    "eth0",
    "https://example.com",
  ]);
  const dialSource = dial.files.map((file) => file.content).join("\n");
  assert.equal(dial.output.support.level, "requires-runtime-helper");
  assert(dial.output.support.items.some((item) => item.behavior === "dns" && item.level === "requires-runtime-helper"));
  assert(dial.output.support.items.some((item) => item.behavior === "network" && item.level === "requires-runtime-helper"));
  assert(dialSource.includes("createCurlDialContext"));
  assert(dialSource.includes("example.com:443:203.0.113.10"));
  await goTest("dial-helper", dial.files);

  const connectTimeout = await generate(["curl", "--connect-timeout", "2", "https://example.com"]);
  assert(connectTimeout.files[0].content.includes("net.Dialer{Timeout: 2000 * time.Millisecond}"));
  await goTest("connect-timeout", connectTimeout.files);

  const debug = await generate(["curl", "-v", "https://example.com"]);
  const debugSource = debug.files[0].content;
  assert.equal(debug.output.support.level, "lossy");
  assert(debug.output.diagnostics.some((item) => item.code === "W_TARGET_LOSSY"));
  assert(debugSource.includes("httputil.DumpRequestOut"));
  assert(debugSource.includes("httputil.DumpResponse"));
  await goTest("debug", debug.files);

  const priorKnowledge = await generate(["curl", "--http2-prior-knowledge", "https://example.com"]);
  assert.equal(priorKnowledge.output.support.level, "lossy");
  assert(priorKnowledge.output.support.items.some((item) => item.behavior === "http.version.2" && item.level === "lossy"));
  assert(priorKnowledge.files[0].content.includes("ForceAttemptHTTP2"));
  await goTest("http2-prior-knowledge", priorKnowledge.files);

  const multi = await generate(["curl", "https://a.test", "--next", "https://b.test"]);
  const multiSource = multi.files[0].content;
  assert(multiSource.indexOf("https://a.test") < multiSource.indexOf("https://b.test"));
  assert.equal((multiSource.match(/http.NewRequestWithContext/g) ?? []).length, 2);
  await goTest("multi", multi.files);

  const ftp = await generate(["curl", "ftp.example.com/README"]);
  const ftpSource = ftp.files[0].content;
  assert.equal(ftp.output.support.level, "unsupported");
  assert(ftp.output.diagnostics.some((item) => item.code === "E_TARGET_URL_SCHEME_UNSUPPORTED"));
  assert(ftpSource.includes("fmt.Fprintln"));
  assert.equal(ftpSource.includes("http.NewRequestWithContext"), false);
  await goTest("unsupported-ftp", ftp.files);
}

async function captureCurlRequest(argv) {
  return new Promise((resolve) => {
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
    server.listen(0, "127.0.0.1", async () => {
      const address = server.address();
      assert(address && typeof address === "object");
      const url = `http://127.0.0.1:${address.port}/capture`;
      await execFileAsync("curl", [...argv, url]);
    });
  });
}

async function captureGoRequest(generatedFiles) {
  return new Promise((resolve) => {
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
    server.listen(0, "127.0.0.1", async () => {
      const address = server.address();
      assert(address && typeof address === "object");
      const url = `http://127.0.0.1:${address.port}/capture`;
      const files = generatedFiles.map((file) => ({
        ...file,
        content: file.content.replace("http://127.0.0.1:1/capture", url),
      }));
      const dir = await writeGoModule("replay", files);
      await execFileAsync("go", ["run", "."], { cwd: dir, env: goEnv });
    });
  });
}

async function testReplay() {
  if (!(await commandExists("go"))) {
    console.log("go binary missing; replay skipped");
    return;
  }
  try {
    await execFileAsync("curl", ["--version"]);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      console.log("curl binary missing; replay skipped");
      return;
    }
    throw error;
  }

  const curlRequest = await captureCurlRequest(["-sS", "-H", "x-test: yes", "--data-raw", "hello"]);
  const generated = await generate([
    "curl",
    "-H",
    "x-test: yes",
    "--data-raw",
    "hello",
    "http://127.0.0.1:1/capture",
  ]);
  const goRequest = await captureGoRequest(generated.files);
  assert.equal(curlRequest.method, goRequest.method);
  assert.equal(curlRequest.headers["x-test"], goRequest.headers["x-test"]);
  assert.equal(curlRequest.body, goRequest.body);
}

async function testHelper() {
  const output = await generate(["curl", "-b", "cookies.txt", "https://example.com"]);
  assert(output.files.some((file) => file.path === "helper.go"));
  assert.equal(output.output.support.level, "requires-runtime-helper");
}

await testCompileCases();
await testHelper();
await testReplay();
console.log("go generator ok");
