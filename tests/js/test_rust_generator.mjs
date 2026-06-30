import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { generateCode, parseCurl } from "../../packages/node/dist/node.js";

const execFileAsync = promisify(execFile);
const outDir = "build/rust-generator";

function file(output, path) {
  const item = output.files.find((candidate) => candidate.path === path);
  assert(item, `missing ${path}`);
  return item;
}

async function generate(argv) {
  const parsed = await parseCurl(argv);
  const output = await generateCode(parsed, { target: "rust.reqwest" });
  assert.equal(output.target, "rust.reqwest");
  assert.equal(output.plan.target, "rust.reqwest");
  return output;
}

async function writeProject(name, output) {
  const dir = join(outDir, name);
  await mkdir(join(dir, "src"), { recursive: true });
  for (const generated of output.files) {
    await writeFile(join(dir, generated.path), generated.content, "utf8");
  }
  return dir;
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

async function validateCargoMetadata(name, output) {
  if (!(await commandExists("cargo"))) {
    console.log("cargo missing; rust generator cargo metadata skipped");
    return;
  }
  const dir = await writeProject(name, output);
  await execFileAsync("cargo", ["metadata", "--no-deps", "--format-version", "1"], { cwd: dir });
  if (process.env.CURL_PARSER_RUN_RUST_GENERATOR_BUILD === "1") {
    await execFileAsync("cargo", ["check", "--bin", "blocking"], { cwd: dir });
    await execFileAsync("cargo", ["check", "--bin", "async"], { cwd: dir });
  }
}

async function testGeneratedProject() {
  const output = await generate([
    "curl",
    "-H",
    "x-test: yes",
    "--data-raw",
    "hello",
    "https://example.com",
  ]);
  const manifest = file(output, "Cargo.toml").content;
  const blocking = file(output, "src/main.rs").content;
  const asyncMain = file(output, "src/async_main.rs").content;
  assert(manifest.includes('reqwest = { version = "0.12"'));
  assert(manifest.includes('"blocking"'));
  assert(blocking.includes("reqwest::blocking::Client::builder()"));
  assert(blocking.includes('request = request.header("x-test", "yes")'));
  assert(blocking.includes('request = request.body("hello")'));
  assert(blocking.includes("reqwest::redirect::Policy::none()"));
  assert(asyncMain.includes("#[tokio::main]"));
  assert(asyncMain.includes("request.send().await?"));
  await validateCargoMetadata("post", output);
}

async function testFeaturesAndFidelity() {
  const output = await generate([
    "curl",
    "--proxy",
    "http://proxy:8080",
    "-k",
    "-F",
    "a=b",
    "https://example.com",
  ]);
  const blocking = file(output, "src/main.rs").content;
  assert(blocking.includes("reqwest::Proxy::all"));
  assert(blocking.includes("danger_accept_invalid_certs"));
  assert(blocking.includes("reqwest::blocking::multipart::Form"));
  await validateCargoMetadata("multipart", output);

  const externalMultipart = await generate(["curl", "-F", "file=@secret.txt", "https://example.com"]);
  const externalMultipartBlocking = file(externalMultipart, "src/main.rs").content;
  assert(externalMultipartBlocking.includes('std::fs::read("secret.txt")'));
  assert(externalMultipartBlocking.includes("reqwest::blocking::multipart::Part::bytes"));
  await validateCargoMetadata("external-multipart", externalMultipart);

  const externalField = await generate(["curl", "-F", "field=<field.txt", "https://example.com"]);
  const externalFieldBlocking = file(externalField, "src/main.rs").content;
  assert(externalFieldBlocking.includes('std::fs::read_to_string("field.txt")'));
  assert(externalFieldBlocking.includes("reqwest::blocking::multipart::Form"));
  await validateCargoMetadata("external-field", externalField);

  const externalJson = await generate(["curl", "--json", "@payload.json", "https://example.com"]);
  const externalJsonBlocking = file(externalJson, "src/main.rs").content;
  assert(externalJsonBlocking.includes('std::fs::read("payload.json")'));
  assert(externalJsonBlocking.includes("reqwest::header::CONTENT_TYPE"));
  await validateCargoMetadata("external-json", externalJson);

  const externalHeaders = await generate(["curl", "-H", "@headers.txt", "https://example.com"]);
  const externalHeadersBlocking = file(externalHeaders, "src/main.rs").content;
  assert(externalHeadersBlocking.includes('std::fs::read_to_string("headers.txt")'));
  assert(externalHeadersBlocking.includes("request = request.header(name.trim(), value.trim_start())"));
  await validateCargoMetadata("external-headers", externalHeaders);

  const multi = await generate(["curl", "https://a.test", "--next", "https://b.test"]);
  const multiBlocking = file(multi, "src/main.rs").content;
  assert(multiBlocking.indexOf("https://a.test") < multiBlocking.indexOf("https://b.test"));
  assert.equal((multiBlocking.match(/request.send/g) ?? []).length, 2);
  await validateCargoMetadata("multi", multi);

  const ftp = await generate(["curl", "ftp.example.com/README"]);
  const ftpBlocking = file(ftp, "src/main.rs").content;
  assert.equal(ftp.support.level, "unsupported");
  assert(ftp.diagnostics.some((item) => item.code === "E_TARGET_URL_SCHEME_UNSUPPORTED"));
  assert(ftpBlocking.includes("std::process::exit(1)"));
  assert.equal(ftpBlocking.includes("reqwest::"), false);
  await validateCargoMetadata("unsupported-ftp", ftp);

  const http3 = await generate(["curl", "--http3", "https://example.com"]);
  assert.notEqual(http3.support.level, "exact");
  assert(http3.support.items.some((item) => item.behavior === "http.version.3"));
}

async function testReqwestSpecificControls() {
  const http2 = await generate(["curl", "--http2-prior-knowledge", "https://example.com"]);
  const http2Manifest = file(http2, "Cargo.toml").content;
  const http2Blocking = file(http2, "src/main.rs").content;
  assert.equal(http2.support.level, "exact");
  assert(http2Manifest.includes('"http2"'));
  assert(http2Blocking.includes("builder = builder.http2_prior_knowledge();"));
  await validateCargoMetadata("http2-prior-knowledge", http2);

  const timeoutRedirect = await generate([
    "curl",
    "-L",
    "--max-redirs",
    "3",
    "--connect-timeout",
    "2",
    "--max-time",
    "5",
    "https://example.com",
  ]);
  const timeoutRedirectBlocking = file(timeoutRedirect, "src/main.rs").content;
  assert(timeoutRedirectBlocking.includes("reqwest::redirect::Policy::limited(3)"));
  assert(timeoutRedirectBlocking.includes("builder = builder.timeout(std::time::Duration::from_millis(5000));"));
  assert(timeoutRedirectBlocking.includes("builder = builder.connect_timeout(std::time::Duration::from_millis(2000));"));
  await validateCargoMetadata("timeout-redirect", timeoutRedirect);

  const proxy = await generate([
    "curl",
    "--proxy",
    "socks5h://proxy.example:1080",
    "--noproxy",
    "localhost,127.0.0.1",
    "https://example.com",
  ]);
  const proxyManifest = file(proxy, "Cargo.toml").content;
  const proxyBlocking = file(proxy, "src/main.rs").content;
  assert(proxyManifest.includes('"socks"'));
  assert(proxyBlocking.includes('reqwest::Proxy::all("socks5h://proxy.example:1080")?'));
  assert(proxyBlocking.includes('reqwest::NoProxy::from_string("localhost,127.0.0.1")'));
  await validateCargoMetadata("proxy-socks-noproxy", proxy);

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
  const tlsBlocking = file(tls, "src/main.rs").content;
  const tlsHelper = file(tls, "src/helper.rs").content;
  assert.equal(tls.support.level, "requires-runtime-helper");
  assert(tls.diagnostics.some((item) => item.code === "W_TARGET_UNSAFE"));
  assert(tlsBlocking.startsWith("mod helper;"));
  assert(tlsBlocking.includes("danger_accept_invalid_certs(true); // curl -k: unsafe outside controlled replay"));
  assert(tlsBlocking.includes('helper::load_root_certificates("ca.pem")'));
  assert(tlsBlocking.includes('helper::load_identity("client.pem", Some("client.key"))'));
  assert(tlsHelper.includes("reqwest::Certificate::from_pem_bundle"));
  assert(tlsHelper.includes("reqwest::Identity::from_pem"));
  await validateCargoMetadata("tls-helper", tls);

  const connector = await generate([
    "curl",
    "--resolve",
    "example.com:443:203.0.113.10",
    "--interface",
    "eth0",
    "--local-port",
    "4000-4002",
    "--connect-to",
    "example.com:443:backend.example:8443",
    "https://example.com",
  ]);
  const connectorBlocking = file(connector, "src/main.rs").content;
  const connectorAsync = file(connector, "src/async_main.rs").content;
  const connectorHelper = file(connector, "src/helper.rs").content;
  assert.equal(connector.support.level, "requires-runtime-helper");
  assert(connector.support.items.some((item) => item.behavior === "dns" && item.level === "requires-runtime-helper"));
  assert(connector.support.items.some((item) => item.behavior === "network" && item.level === "requires-runtime-helper"));
  assert(connectorBlocking.includes("helper::configure_blocking_connector"));
  assert(connectorAsync.includes("helper::configure_async_connector"));
  assert(connectorHelper.includes("TODO: provide reqwest connector/resolver"));
  await validateCargoMetadata("connector-helper", connector);

  const debug = await generate(["curl", "-v", "https://example.com"]);
  const debugBlocking = file(debug, "src/main.rs").content;
  assert.equal(debug.support.level, "lossy");
  assert(debug.diagnostics.some((item) => item.code === "W_TARGET_LOSSY"));
  assert(debugBlocking.includes("builder = builder.connection_verbose(true);"));
  await validateCargoMetadata("debug", debug);
}

await testGeneratedProject();
await testFeaturesAndFidelity();
await testReqwestSpecificControls();
console.log("rust generator ok");
