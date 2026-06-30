import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { generateCode, parseCurl } from "../../packages/node/dist/node.js";

const execFileAsync = promisify(execFile);
const outDir = "build/javascript-generators";

function file(output, path) {
  const item = output.files.find((candidate) => candidate.path === path);
  assert(item, `missing ${path}`);
  assert.equal(item.role, "main");
  return item;
}

async function generate(argv, target, options = {}) {
  const parsed = await parseCurl(argv);
  const output = await generateCode(parsed, { target, options });
  assert.equal(output.target, target);
  assert.equal(output.plan.target, target);
  return output;
}

async function checkJavaScript(name, source) {
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, name);
  await writeFile(path, source, "utf8");
  await execFileAsync("node", ["--check", path]);
}

async function testFetchGenerator() {
  const getOutput = await generate(["curl", "https://example.com"], "js.fetch");
  const getSource = file(getOutput, "main.js").content;
  assert.equal(getOutput.support.level, "exact");
  assert(getSource.includes("await fetch(url, init)"));
  assert(getSource.includes('redirect: "manual"'));
  assert(!getSource.includes("undici"));
  assert(!getSource.includes("process."));
  await checkJavaScript("fetch-get.js", getSource);

  const postOutput = await generate(
    ["curl", "-H", "x-test: yes", "--data-raw", "hello", "https://example.com"],
    "js.fetch",
  );
  const postSource = file(postOutput, "main.js").content;
  assert(postSource.includes('["x-test", "yes"]'));
  assert(postSource.includes('body: "hello"'));
  await checkJavaScript("fetch-post.js", postSource);

  const multiOutput = await generate(
    ["curl", "https://a.test", "--next", "https://b.test"],
    "js.fetch",
  );
  const multiSource = file(multiOutput, "main.js").content;
  assert(multiSource.indexOf("https://a.test") < multiSource.indexOf("https://b.test"));
  assert(multiSource.includes("await fetch(url0, init0)"));
  assert(multiSource.includes("await fetch(url1, init1)"));
  await checkJavaScript("fetch-multi.js", multiSource);

  const redirectTimeout = await generate(
    [
      "curl",
      "-L",
      "--max-redirs",
      "2",
      "--max-time",
      "5",
      "https://example.com",
    ],
    "js.fetch",
  );
  const redirectTimeoutSource = file(redirectTimeout, "main.js").content;
  assert.equal(redirectTimeout.support.level, "requires-runtime-helper");
  assert(redirectTimeout.support.items.some((item) => item.behavior === "redirects" && item.level === "lossy"));
  assert(redirectTimeout.support.items.some((item) => item.behavior === "timeout" && item.level === "requires-runtime-helper"));
  assert(redirectTimeoutSource.includes('redirect: "follow"'));
  assert(redirectTimeoutSource.includes("new AbortController()"));
  assert(redirectTimeoutSource.includes("setTimeout(() => controller.abort(), 5000)"));
  await checkJavaScript("fetch-redirect-timeout.js", redirectTimeoutSource);
}

async function testUndiciGenerator() {
  const output = await generate(
    ["curl", "--proxy", "http://proxy:8080", "-k", "https://example.com"],
    "js.undici",
  );
  const source = file(output, "main.mjs").content;
  assert(source.includes('from "undici"'));
  assert(source.includes("ProxyAgent"));
  assert(source.includes("request(url, options)"));
  assert(source.includes("requestTls"));
  await checkJavaScript("undici-proxy.mjs", source);

  const proxy = await generate(
    [
      "curl",
      "--proxy",
      "http://proxy.example:8080",
      "--proxy-header",
      "X-Proxy: yes",
      "--proxy-user",
      "proxy-user:proxy-pass",
      "--proxytunnel",
      "https://example.com",
    ],
    "js.undici",
  );
  const proxySource = file(proxy, "main.mjs").content;
  assert.equal(proxy.support.level, "exact");
  assert(proxySource.includes("new ProxyAgent({"));
  assert(proxySource.includes('token: "Basic REDACTED"'));
  assert(proxySource.includes('"X-Proxy": "yes"'));
  assert(proxySource.includes("proxyTunnel: true"));
  assert.equal(proxySource.includes("Proxy-Authorization"), false);
  assert.equal(proxySource.includes("authorization"), false);
  await checkJavaScript("undici-proxy-detailed.mjs", proxySource);

  const socks = await generate(
    ["curl", "--socks5-hostname", "socks.example:1080", "https://example.com"],
    "js.undici",
  );
  const socksSource = file(socks, "main.mjs").content;
  assert.equal(socks.support.level, "exact");
  assert(socksSource.includes("Socks5ProxyAgent"));
  assert(socksSource.includes('"socks5://socks.example:1080"'));
  await checkJavaScript("undici-socks.mjs", socksSource);

  const tls = await generate(
    [
      "curl",
      "--proxy",
      "https://proxy.example:8443",
      "--proxy-insecure",
      "--proxy-cacert",
      "proxy-ca.pem",
      "--proxy-cert",
      "proxy-client.pem",
      "--proxy-key",
      "proxy-client.key",
      "-k",
      "--cacert",
      "ca.pem",
      "--cert",
      "client.pem",
      "--key",
      "client.key",
      "https://example.com",
    ],
    "js.undici",
  );
  const tlsSource = file(tls, "main.mjs").content;
  assert.equal(tls.support.level, "requires-runtime-helper");
  assert(tlsSource.includes("requestTls"));
  assert(tlsSource.includes("proxyTls"));
  assert(tlsSource.indexOf("requestTls") < tlsSource.indexOf("proxyTls"));
  assert(tlsSource.includes('ca: await readFile("ca.pem")'));
  assert(tlsSource.includes('ca: await readFile("proxy-ca.pem")'));
  await checkJavaScript("undici-tls.mjs", tlsSource);

  const connector = await generate(
    [
      "curl",
      "--resolve",
      "example.com:443:203.0.113.10",
      "--interface",
      "eth0",
      "https://example.com",
    ],
    "js.undici",
  );
  const connectorSource = file(connector, "main.mjs").content;
  assert.equal(connector.support.level, "requires-runtime-helper");
  assert(connector.support.items.some((item) => item.behavior === "dns" && item.level === "requires-runtime-helper"));
  assert(connector.support.items.some((item) => item.behavior === "network" && item.level === "requires-runtime-helper"));
  assert(connectorSource.includes("createUndiciConnectorDispatcher"));
  assert(connectorSource.includes("dispatcher: dispatcher"));
  await checkJavaScript("undici-connector-helper.mjs", connectorSource);

  const debug = await generate(["curl", "-v", "https://example.com"], "js.undici");
  const debugSource = file(debug, "main.mjs").content;
  assert.equal(debug.support.level, "lossy");
  assert(debug.diagnostics.some((item) => item.code === "W_TARGET_LOSSY"));
  assert(debugSource.includes('import diagnosticsChannel from "node:diagnostics_channel";'));
  assert(debugSource.includes("subscribeUndiciDiagnostics();"));
  await checkJavaScript("undici-debug.mjs", debugSource);

  const http2 = await generate(["curl", "--http2", "https://example.com"], "js.undici");
  const http2Source = file(http2, "main.mjs").content;
  assert.equal(http2.support.level, "unsupported");
  assert(http2.diagnostics.some((item) => item.code === "E_TARGET_UNSUPPORTED"));
  assert(http2Source.includes("throw new Error"));
  assert.equal(http2Source.includes("request("), false);
  await checkJavaScript("undici-http2-unsupported.mjs", http2Source);

  const multi = await generate(["curl", "https://a.test", "--next", "https://b.test"], "js.undici");
  const multiSource = file(multi, "main.mjs").content;
  assert(multiSource.indexOf("https://a.test") < multiSource.indexOf("https://b.test"));
  assert(multiSource.includes("request(url0, options0)"));
  assert(multiSource.includes("request(url1, options1)"));
  await checkJavaScript("undici-multi.mjs", multiSource);

  const multipart = await generate(["curl", "-F", "file=@secret.txt", "https://example.com"], "js.undici");
  const multipartSource = file(multipart, "main.mjs").content;
  assert(multipartSource.includes("new FormData()"));
  assert(multipartSource.includes('new Blob([await readFile("secret.txt")])'));
  assert.equal(multipartSource.includes('body: await readFile("secret.txt")'), false);
  await checkJavaScript("undici-multipart-external.mjs", multipartSource);

  const json = await generate(["curl", "--json", "@payload.json", "https://example.com"], "js.undici");
  const jsonSource = file(json, "main.mjs").content;
  assert(jsonSource.includes('import { readFile } from "node:fs/promises";'));
  assert(jsonSource.includes('const headers = {"content-type":"application/json"};'));
  assert(jsonSource.includes('body: await readFile("payload.json")'));
  await checkJavaScript("undici-json-external.mjs", jsonSource);

  const headerFile = await generate(["curl", "-H", "@headers.txt", "https://example.com"], "js.undici");
  const headerSource = file(headerFile, "main.mjs").content;
  assert(headerSource.includes('await readFile("headers.txt", "utf8")'));
  assert(headerSource.includes("headers[line.slice(0, index)]"));
  await checkJavaScript("undici-header-external.mjs", headerSource);
}

async function testAxiosGenerator() {
  const output = await generate(
    ["curl", "-H", "x-test: yes", "--data-raw", "hello", "-k", "https://example.com"],
    "js.axios",
  );
  const source = file(output, "main.mjs").content;
  assert.equal(output.support.level, "exact");
  assert(source.includes('import axios from "axios"'));
  assert(source.includes('import https from "node:https"'));
  assert(source.includes("axios.request(requestOptions)"));
  assert(source.includes('data = "hello"'));
  assert(source.includes("https.Agent"));
  assert(source.includes("maxRedirects: 0"));
  await checkJavaScript("axios-post.mjs", source);

  const proxy = await generate(
    [
      "curl",
      "--proxy",
      "http://proxy.example:8080",
      "--proxy-user",
      "proxy-user:proxy-pass",
      "-L",
      "--max-redirs",
      "3",
      "--max-time",
      "5",
      "https://example.com",
    ],
    "js.axios",
  );
  const proxySource = file(proxy, "main.mjs").content;
  assert.equal(proxy.support.level, "exact");
  assert(proxySource.includes("requestOptions.proxy = {"));
  assert(proxySource.includes('protocol: "http"'));
  assert(proxySource.includes('host: "proxy.example"'));
  assert(proxySource.includes("port: 8080"));
  assert(proxySource.includes('auth: { username: "REDACTED", password: "REDACTED" }'));
  assert(proxySource.includes("maxRedirects: 3"));
  assert(proxySource.includes("requestOptions.signal = controller.signal"));
  assert.equal(proxySource.includes("Proxy-Authorization"), false);
  assert.equal(proxySource.includes("headers.authorization"), false);
  await checkJavaScript("axios-proxy-http.mjs", proxySource);

  const socks = await generate(
    ["curl", "--socks5-hostname", "socks.example:1080", "https://example.com"],
    "js.axios",
  );
  const socksSource = file(socks, "main.mjs").content;
  assert.equal(socks.support.level, "requires-runtime-helper");
  assert(socks.support.items.some((item) => item.behavior === "proxy" && item.level === "requires-runtime-helper"));
  assert(socksSource.includes("function createSocksProxyAgent"));
  assert(socksSource.includes('"socks5://socks.example:1080"'));
  assert(socksSource.includes("requestOptions.proxy = false"));
  assert(socksSource.includes("requestOptions.httpAgent = proxyAgent"));
  assert(socksSource.includes("requestOptions.httpsAgent = proxyAgent"));
  await checkJavaScript("axios-proxy-socks.mjs", socksSource);

  const proxyHeaders = await generate(
    [
      "curl",
      "--proxy",
      "http://proxy.example:8080",
      "--proxy-header",
      "X-Proxy: yes",
      "https://example.com",
    ],
    "js.axios",
  );
  const proxyHeadersSource = file(proxyHeaders, "main.mjs").content;
  assert.equal(proxyHeaders.support.level, "requires-runtime-helper");
  assert(proxyHeadersSource.includes("function createAxiosProxyAgent"));
  assert(proxyHeadersSource.includes('"X-Proxy": "yes"'));
  assert(proxyHeadersSource.includes("requestOptions.proxy = false"));
  await checkJavaScript("axios-proxy-header-helper.mjs", proxyHeadersSource);

  const tls = await generate(
    [
      "curl",
      "-k",
      "--cacert",
      "ca.pem",
      "--cert",
      "client.pem",
      "--key",
      "client.key",
      "https://example.com",
    ],
    "js.axios",
  );
  const tlsSource = file(tls, "main.mjs").content;
  assert.equal(tls.support.level, "requires-runtime-helper");
  assert(tlsSource.includes('import { readFile } from "node:fs/promises";'));
  assert(tlsSource.includes("new https.Agent({"));
  assert(tlsSource.includes('ca: await readFile("ca.pem")'));
  assert(tlsSource.includes('cert: await readFile("client.pem")'));
  assert(tlsSource.includes('key: await readFile("client.key")'));
  await checkJavaScript("axios-tls-agent.mjs", tlsSource);

  const http2 = await generate(["curl", "--http2", "https://example.com"], "js.axios", { runtimeHelpers: "allow" });
  const http2Source = file(http2, "main.mjs").content;
  assert.equal(http2.support.level, "lossy");
  assert(http2.diagnostics.some((item) => item.code === "W_TARGET_LOSSY"));
  assert(http2Source.includes('requestOptions.adapter = "http"'));
  assert(http2Source.includes("requestOptions.httpVersion = 2"));
  assert(http2Source.includes("requestOptions.http2Options = {}"));
  await checkJavaScript("axios-http2-lossy.mjs", http2Source);

  const multipart = await generate(["curl", "-F", "file=@secret.txt", "https://example.com"], "js.axios");
  const multipartSource = file(multipart, "main.mjs").content;
  assert(multipartSource.includes('import { readFile } from "node:fs/promises";'));
  assert(multipartSource.includes("new FormData()"));
  assert(multipartSource.includes('new Blob([await readFile("secret.txt")])'));
  await checkJavaScript("axios-multipart-external.mjs", multipartSource);
}

async function testDuplicateHeaderWarning() {
  const output = await generate(
    ["curl", "-H", "x-test: one", "-H", "x-test: two", "https://example.com"],
    "js.fetch",
  );
  assert.equal(output.support.level, "lossy");
  assert(output.diagnostics.some((item) => item.code === "W_TARGET_LOSSY"));
}

async function testUnsupportedScheme() {
  for (const target of ["js.fetch", "js.undici", "js.axios"]) {
    const output = await generate(["curl", "ftp.example.com/README"], target);
    const source = file(output, target === "js.fetch" ? "main.js" : "main.mjs").content;
    assert.equal(output.support.level, "unsupported");
    assert(output.diagnostics.some((item) => item.code === "E_TARGET_URL_SCHEME_UNSUPPORTED"));
    assert(source.includes("throw new Error"));
    assert.equal(source.includes("fetch("), false);
    assert.equal(source.includes("request("), false);
    await checkJavaScript(`unsupported-${target}.mjs`, source);
  }
}

async function testBrowserExternalRefUnsupported() {
  const output = await generate(["curl", "--data-binary", "@payload.txt", "https://example.com"], "js.fetch");
  const source = file(output, "main.js").content;
  assert.equal(output.support.level, "unsupported");
  assert(output.diagnostics.some((item) => item.code === "E_TARGET_EXTERNAL_REF_UNSUPPORTED"));
  assert(source.includes("throw new Error"));
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("readFile"), false);
  await checkJavaScript("fetch-external-unsupported.mjs", source);

  const helper = await generate(
    ["curl", "--data-binary", "@payload.txt", "https://example.com"],
    "js.fetch",
    { runtimeHelpers: "allow" },
  );
  const helperSource = file(helper, "main.js").content;
  assert.equal(helper.support.level, "requires-runtime-helper");
  assert(helper.support.items.some((item) => item.behavior === "external-ref"));
  assert(helperSource.includes("async function loadExternalBytes(refId)"));
  assert(helperSource.includes('body: await loadExternalBytes("external-0")'));
  assert.equal(helperSource.includes("readFile"), false);
  await checkJavaScript("fetch-external-helper.mjs", helperSource);
}

async function testFetchUnsupportedDomains() {
  const proxy = await generate(["curl", "--proxy", "http://proxy:8080", "https://example.com"], "js.fetch");
  assert.equal(proxy.support.level, "unsupported");
  assert(proxy.support.items.some((item) => item.behavior === "proxy" && item.level === "unsupported"));

  const tls = await generate(
    [
      "curl",
      "-k",
      "--cacert",
      "ca.pem",
      "--cert",
      "client.pem",
      "--key",
      "client.key",
      "https://example.com",
    ],
    "js.fetch",
  );
  assert.equal(tls.support.level, "unsupported");
  for (const behavior of ["tls.verify", "tls.ca", "tls.client-cert"]) {
    assert(tls.support.items.some((item) => item.behavior === behavior && item.level === "unsupported"), behavior);
  }

  const network = await generate(
    [
      "curl",
      "--interface",
      "eth0",
      "--local-port",
      "4000-4002",
      "--connect-to",
      "example.com:443:backend.example:8443",
      "https://example.com",
    ],
    "js.fetch",
  );
  assert(network.support.items.some((item) => item.behavior === "network" && item.level === "unsupported"));

  const dns = await generate(
    ["curl", "--resolve", "example.com:443:203.0.113.10", "https://example.com"],
    "js.fetch",
  );
  assert(dns.support.items.some((item) => item.behavior === "dns" && item.level === "unsupported"));

  const debug = await generate(["curl", "-v", "https://example.com"], "js.fetch");
  assert.equal(debug.support.level, "unsupported");
  assert(debug.support.items.some((item) => item.behavior === "debug" && item.level === "unsupported"));
  assert(debug.diagnostics.some((item) => item.code === "E_TARGET_UNSUPPORTED"));
}

async function testFetchSnapshots() {
  const dir = "fixtures/generator/js.fetch";
  const inputs = (await readdir(dir)).filter((name) => name.endsWith(".input.json")).sort();
  assert(inputs.length > 0, "missing js.fetch generator snapshots");

  for (const inputName of inputs) {
    const base = inputName.slice(0, -".input.json".length);
    const payload = JSON.parse(await readFile(join(dir, inputName), "utf8"));
    assert.equal(payload.schemaVersion, "curl-parser-generator-fixture/v1", inputName);
    const output = await generate(payload.argv, payload.target ?? "js.fetch", payload.options ?? {});
    const source = file(output, "main.js").content;

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
    assert.equal(source, await readFile(join(dir, `${base}.main.js`), "utf8"), base);
    await checkJavaScript(`snapshot-fetch-${base}.mjs`, source);
  }
}

async function testUndiciSnapshots() {
  const dir = "fixtures/generator/js.undici";
  const inputs = (await readdir(dir)).filter((name) => name.endsWith(".input.json")).sort();
  assert(inputs.length > 0, "missing js.undici generator snapshots");

  for (const inputName of inputs) {
    const base = inputName.slice(0, -".input.json".length);
    const payload = JSON.parse(await readFile(join(dir, inputName), "utf8"));
    assert.equal(payload.schemaVersion, "curl-parser-generator-fixture/v1", inputName);
    const output = await generate(payload.argv, payload.target ?? "js.undici", payload.options ?? {});
    const source = file(output, "main.mjs").content;

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
    assert.equal(source, await readFile(join(dir, `${base}.main.mjs`), "utf8"), base);
    await checkJavaScript(`snapshot-undici-${base}.mjs`, source);
  }
}

async function testAxiosSnapshots() {
  const dir = "fixtures/generator/js.axios";
  const inputs = (await readdir(dir)).filter((name) => name.endsWith(".input.json")).sort();
  assert(inputs.length > 0, "missing js.axios generator snapshots");

  for (const inputName of inputs) {
    const base = inputName.slice(0, -".input.json".length);
    const payload = JSON.parse(await readFile(join(dir, inputName), "utf8"));
    assert.equal(payload.schemaVersion, "curl-parser-generator-fixture/v1", inputName);
    const output = await generate(payload.argv, payload.target ?? "js.axios", payload.options ?? {});
    const source = file(output, "main.mjs").content;

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
    assert.equal(source, await readFile(join(dir, `${base}.main.mjs`), "utf8"), base);
    await checkJavaScript(`snapshot-axios-${base}.mjs`, source);
  }
}

await testFetchGenerator();
await testUndiciGenerator();
await testAxiosGenerator();
await testDuplicateHeaderWarning();
await testUnsupportedScheme();
await testBrowserExternalRefUnsupported();
await testFetchUnsupportedDomains();
await testFetchSnapshots();
await testUndiciSnapshots();
await testAxiosSnapshots();
console.log("javascript generators ok");
