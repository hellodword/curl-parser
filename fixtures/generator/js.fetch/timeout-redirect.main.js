const url = "https://example.com";
const headers = new Headers([
]);

const init = {
  method: "GET",
  headers: headers,
  redirect: "follow",
};

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5000);
init.signal = controller.signal;

const response = await fetch(url, init);
clearTimeout(timeout);
if (!response.ok) {
  throw new Error(`HTTP ${response.status}`);
}
console.log(await response.text());
