const url = "https://example.com";
const headers = new Headers([
  ["x-test", "yes"],
]);

const init = {
  method: "POST",
  headers: headers,
  redirect: "manual",
  body: "hello",
};

const response = await fetch(url, init);
if (!response.ok) {
  throw new Error(`HTTP ${response.status}`);
}
console.log(await response.text());
