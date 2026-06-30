import { Socks5ProxyAgent, request } from "undici";

const url = "https://example.com";
const headers = {};
const proxyAgent = new Socks5ProxyAgent("socks5://socks.example:1080");

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
