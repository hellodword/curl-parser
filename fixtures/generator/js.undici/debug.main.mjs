import { request } from "undici";
import diagnosticsChannel from "node:diagnostics_channel";

function subscribeUndiciDiagnostics() {
  for (const name of [
    "undici:request:create",
    "undici:request:headers",
    "undici:request:error",
    "undici:proxy:connected",
  ]) {
    diagnosticsChannel.channel(name).subscribe((message) => {
      console.error(name, message);
    });
  }
}

subscribeUndiciDiagnostics();

const url = "https://example.com";
const headers = {};

const options = {
  method: "GET",
  headers: headers,
};

const { statusCode: statusCode, body: body } = await request(url, options);
if (statusCode < 200 || statusCode >= 300) {
  throw new Error(`HTTP ${statusCode}`);
}
console.log(await body.text());
