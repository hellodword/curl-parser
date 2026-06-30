import { ProxyAgent, request } from "undici";

const url = "https://example.com";
const headers = {};
const proxyAgent = new ProxyAgent({
  uri: "http://proxy.example:8080",
  token: "Basic REDACTED",
  headers: {
    "X-Proxy": "yes",
  },
  proxyTunnel: true,
});

const options = {
  method: "GET",
  headers: headers,
  bodyTimeout: 5000,
  headersTimeout: 5000,
  maxRedirections: 3,
  dispatcher: proxyAgent,
};

const { statusCode: statusCode, body: body } = await request(url, options);
if (statusCode < 200 || statusCode >= 300) {
  throw new Error(`HTTP ${statusCode}`);
}
console.log(await body.text());
