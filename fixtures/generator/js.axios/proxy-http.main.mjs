import axios from "axios";

const url = "https://example.com";
const headers = {};

const requestOptions = {
  url: url,
  method: "GET",
  headers: headers,
  maxRedirects: 3,
};
requestOptions.timeout = 5000;
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5000);
requestOptions.signal = controller.signal;
requestOptions.proxy = {
  protocol: "http",
  host: "proxy.example",
  port: 8080,
  auth: { username: "REDACTED", password: "REDACTED" },
};

const response = await axios.request(requestOptions);
clearTimeout(timeout);
if (response.status < 200 || response.status >= 300) {
  throw new Error(`HTTP ${response.status}`);
}
console.log(typeof response.data === "string" ? response.data : JSON.stringify(response.data));
