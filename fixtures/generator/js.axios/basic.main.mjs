import axios from "axios";

const url = "https://example.com";
const headers = {"x-test":"yes"};

const requestOptions = {
  url: url,
  method: "POST",
  headers: headers,
  maxRedirects: 0,
};
requestOptions.data = "hello";

const response = await axios.request(requestOptions);
if (response.status < 200 || response.status >= 300) {
  throw new Error(`HTTP ${response.status}`);
}
console.log(typeof response.data === "string" ? response.data : JSON.stringify(response.data));
