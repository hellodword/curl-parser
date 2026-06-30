import { ProxyAgent, request } from "undici";
import { readFile } from "node:fs/promises";

const url = "https://example.com";
const headers = {};
const proxyAgent = new ProxyAgent({
  uri: "https://proxy.example:8443",
  requestTls: {
    rejectUnauthorized: false,
    ca: await readFile("ca.pem"),
    cert: await readFile("client.pem"),
    key: await readFile("client.key"),
  },
  proxyTls: {
    rejectUnauthorized: false,
    ca: await readFile("proxy-ca.pem"),
    cert: await readFile("proxy-client.pem"),
    key: await readFile("proxy-client.key"),
  },
});

const options = {
  method: "GET",
  headers: headers,
  dispatcher: proxyAgent,
};

const { statusCode: statusCode, body: body } = await request(url, options);
if (statusCode < 200 || statusCode >= 300) {
  throw new Error(`HTTP ${statusCode}`);
}
console.log(await body.text());
