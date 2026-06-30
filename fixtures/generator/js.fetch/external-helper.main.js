async function loadExternalBytes(refId) {
  throw new Error(`TODO: provide bytes for external reference ${refId}`);
}

async function loadExternalText(refId) {
  throw new Error(`TODO: provide text for external reference ${refId}`);
}

const url = "https://example.com";
const headers = new Headers([
]);

const init = {
  method: "POST",
  headers: headers,
  redirect: "manual",
  body: await loadExternalBytes("external-0"),
};

const response = await fetch(url, init);
if (!response.ok) {
  throw new Error(`HTTP ${response.status}`);
}
console.log(await response.text());
