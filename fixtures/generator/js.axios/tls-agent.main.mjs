import axios from "axios";
import https from "node:https";
import { readFile } from "node:fs/promises";

const url = "https://example.com";
const headers = {};
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
  ca: await readFile("ca.pem"),
  cert: await readFile("client.pem"),
  key: await readFile("client.key"),
});

const requestOptions = {
  url: url,
  method: "GET",
  headers: headers,
  maxRedirects: 0,
};
requestOptions.httpsAgent = httpsAgent;

const response = await axios.request(requestOptions);
if (response.status < 200 || response.status >= 300) {
  throw new Error(`HTTP ${response.status}`);
}
console.log(typeof response.data === "string" ? response.data : JSON.stringify(response.data));
