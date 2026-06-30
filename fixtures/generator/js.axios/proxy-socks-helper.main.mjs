import axios from "axios";

function createSocksProxyAgent(curlProxyConfig) {
  throw new Error(`TODO: provide a socks-proxy-agent instance for ${JSON.stringify(curlProxyConfig)}`);
}

const url = "https://example.com";
const headers = {};
const proxyAgent = createSocksProxyAgent({
  uri: "socks5://socks.example:1080",
});

const requestOptions = {
  url: url,
  method: "GET",
  headers: headers,
  maxRedirects: 0,
};
requestOptions.proxy = false;
requestOptions.httpAgent = proxyAgent;
requestOptions.httpsAgent = proxyAgent;

const response = await axios.request(requestOptions);
if (response.status < 200 || response.status >= 300) {
  throw new Error(`HTTP ${response.status}`);
}
console.log(typeof response.data === "string" ? response.data : JSON.stringify(response.data));
