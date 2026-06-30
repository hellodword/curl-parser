import axios from "axios";

const url = "https://example.com";
const headers = {};

const requestOptions = {
  url: url,
  method: "GET",
  headers: headers,
  maxRedirects: 0,
};
requestOptions.adapter = "http";
requestOptions.httpVersion = 2;
requestOptions.http2Options = {};

const response = await axios.request(requestOptions);
if (response.status < 200 || response.status >= 300) {
  throw new Error(`HTTP ${response.status}`);
}
console.log(typeof response.data === "string" ? response.data : JSON.stringify(response.data));
