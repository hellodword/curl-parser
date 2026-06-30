import type {
  CurlIr,
  GenerateInput,
  GenerateOutput,
  GeneratedFile,
} from "./types.js";

type JsonRecord = Record<string, unknown>;
type RuntimeHelpersMode = "allow" | "inline" | "forbid";
type PythonClientStyle = "sync" | "async";

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function httpVersionValue(value: unknown): string | undefined {
  return asString(value) ?? asString(asRecord(value)?.value);
}

function externalRefById(ir: CurlIr, id: string | undefined): JsonRecord | undefined {
  if (!id) {
    return undefined;
  }
  return ir.externalRefs
    .map((value) => asRecord(value))
    .find((value) => value?.id === id);
}

function bodyExternalRef(ir: CurlIr, body: JsonRecord | undefined): JsonRecord | undefined {
  return externalRefById(ir, asString(body?.externalRefId));
}

function refById(ir: CurlIr, id: unknown): JsonRecord | undefined {
  return externalRefById(ir, asString(id));
}

function refValue(ref: JsonRecord | undefined): string | undefined {
  return asString(ref?.value);
}

function runtimeHelpers(input: GenerateInput): RuntimeHelpersMode {
  return input.options?.runtimeHelpers ?? "allow";
}

function pythonStyle(input: GenerateInput): PythonClientStyle {
  return input.target === "python.httpx" && input.options?.style === "async" ? "async" : "sync";
}

function refToken(ref: JsonRecord): string {
  return asString(ref.id) ?? "external";
}

function pythonExternalRead(input: GenerateInput, ref: JsonRecord | undefined): string | undefined {
  if (!ref) {
    return undefined;
  }
  if (runtimeHelpers(input) === "inline") {
    return `load_external_bytes(${pythonString(refToken(ref))})`;
  }
  if (ref.kind === "stdin") {
    return "sys.stdin.buffer.read()";
  }
  const value = asString(ref.value);
  return value ? `Path(${pythonString(value)}).read_bytes()` : undefined;
}

function transferRecords(ir: CurlIr): JsonRecord[] {
  const transfers: JsonRecord[] = [];
  for (const groupValue of ir.groups) {
    const group = asRecord(groupValue);
    for (const transferValue of asArray(group?.transfers)) {
      const transfer = asRecord(transferValue);
      if (transfer) {
        transfers.push(transfer);
      }
    }
  }
  return transfers;
}

function pythonString(value: string): string {
  return JSON.stringify(value);
}

function pythonLiteral(value: unknown): string {
  if (value === null) {
    return "None";
  }
  if (typeof value === "boolean") {
    return value ? "True" : "False";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "None";
  }
  if (typeof value === "string") {
    return pythonString(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => pythonLiteral(item)).join(", ")}]`;
  }
  const record = asRecord(value);
  if (record) {
    const entries = Object.entries(record).map(
      ([key, item]) => `${pythonString(key)}: ${pythonLiteral(item)}`,
    );
    return `{${entries.join(", ")}}`;
  }
  return "None";
}

function pythonDict(entries: Array<[string, string]>): string {
  if (entries.length === 0) {
    return "{}";
  }
  return `{${entries.map(([key, value]) => `${pythonString(key)}: ${value}`).join(", ")}}`;
}

function headerEntries(effective: JsonRecord): Array<[string, string]> {
  return asArray(effective.headers)
    .map((value) => {
      const header = asRecord(value);
      const name = asString(header?.name);
      const fieldValue = asString(header?.value);
      return name && fieldValue !== undefined
        ? ([name, pythonString(fieldValue)] as [string, string])
        : undefined;
    })
    .filter((value): value is [string, string] => Array.isArray(value));
}

function externalHeaderRefs(ir: CurlIr, effective: JsonRecord): JsonRecord[] {
  return asArray(effective.headers)
    .map((value) => externalRefById(ir, asString(asRecord(value)?.externalRefId)))
    .filter((value): value is JsonRecord => Boolean(value));
}

function pythonExternalText(input: GenerateInput, ref: JsonRecord | undefined): string | undefined {
  if (!ref) {
    return undefined;
  }
  if (runtimeHelpers(input) === "inline") {
    return `load_external_text(${pythonString(refToken(ref))})`;
  }
  if (ref.kind === "stdin") {
    return "sys.stdin.read()";
  }
  const value = asString(ref.value);
  return value ? `Path(${pythonString(value)}).read_text()` : undefined;
}

function cookieEntries(value: string): Array<[string, string]> {
  return value
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const equal = item.indexOf("=");
      return equal >= 0
        ? ([item.slice(0, equal), pythonString(item.slice(equal + 1))] as [string, string])
        : ([item, pythonString("")] as [string, string]);
    });
}

function inlineCookieValue(effective: JsonRecord): string | undefined {
  return asArray(effective.cookies)
    .map((value) => asString(asRecord(value)?.value))
    .find((value) => typeof value === "string" && value.includes("="));
}

function cookieJarRef(ir: CurlIr, effective: JsonRecord): JsonRecord | undefined {
  return asArray(effective.cookies)
    .map((value) => refById(ir, asRecord(value)?.externalRefId))
    .find((value): value is JsonRecord => Boolean(value));
}

function splitFormValue(value: string): [string, string] {
  const equal = value.indexOf("=");
  if (equal < 0) {
    return [value || "field", ""];
  }
  return [value.slice(0, equal) || "field", value.slice(equal + 1)];
}

function externalFileName(ref: JsonRecord | undefined): string {
  const value = asString(ref?.value) ?? "upload";
  return value.split(/[\\/]/u).filter(Boolean).at(-1) || "upload";
}

function jsonBodyFromBody(bodyKind: string | undefined, bodyValue: string): unknown | undefined {
  if (bodyKind !== "json") {
    return undefined;
  }
  try {
    return JSON.parse(bodyValue);
  } catch {
    return undefined;
  }
}

function secondsFromMilliseconds(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return value / 1000;
}

function variableName(base: string, index: number, multi: boolean): string {
  return multi ? `${base}_${index}` : base;
}

function pythonLibrary(input: GenerateInput): "requests" | "httpx" {
  return input.target === "python.httpx" ? "httpx" : "requests";
}

function usesHttp2(ir: CurlIr): boolean {
  return transferRecords(ir).some((transfer) =>
    httpVersionValue(asRecord(transfer.effective)?.httpVersion) === "2"
  );
}

function usesDebug(ir: CurlIr): boolean {
  return transferRecords(ir).some((transfer) => {
    const debug = asRecord(asRecord(transfer.effective)?.debug);
    return debug ? Object.keys(debug).length > 0 : false;
  });
}

function needsInlineExternalHelpers(input: GenerateInput): boolean {
  return runtimeHelpers(input) === "inline" && input.ir.externalRefs.length > 0;
}

function certificateExpression(ir: CurlIr, tls: JsonRecord | undefined): string | undefined {
  const cert = refValue(refById(ir, tls?.clientCertRefId)) ?? asString(tls?.clientCert);
  const key = refValue(refById(ir, tls?.clientKeyRefId));
  if (cert && key) {
    return `(${pythonString(cert)}, ${pythonString(key)})`;
  }
  return cert ? pythonString(cert) : undefined;
}

function caBundleExpression(ir: CurlIr, tls: JsonRecord | undefined): string | undefined {
  return refValue(refById(ir, tls?.caFileRefId)) ?? asString(tls?.caBundle);
}

function cookieJarArgument(input: GenerateInput, ref: JsonRecord | undefined): string | undefined {
  if (!ref) {
    return undefined;
  }
  if (runtimeHelpers(input) === "inline") {
    return pythonString(refToken(ref));
  }
  const value = refValue(ref);
  return value ? pythonString(value) : undefined;
}

function firstEffective(input: GenerateInput): JsonRecord {
  const transfer = transferRecords(input.ir)[0];
  return asRecord(transfer?.effective) ?? {};
}

function timeoutExpression(
  library: "requests" | "httpx",
  connectTimeout: number | undefined,
  maxTime: number | undefined,
): string | undefined {
  if (library === "httpx") {
    if (connectTimeout !== undefined && maxTime !== undefined) {
      return `httpx.Timeout(${maxTime}, connect=${connectTimeout})`;
    }
    if (maxTime !== undefined) {
      return String(maxTime);
    }
    if (connectTimeout !== undefined) {
      return `httpx.Timeout(None, connect=${connectTimeout})`;
    }
    return undefined;
  }
  if (connectTimeout !== undefined && maxTime !== undefined) {
    return `(${connectTimeout}, ${maxTime})`;
  }
  if (maxTime !== undefined) {
    return String(maxTime);
  }
  if (connectTimeout !== undefined) {
    return `(${connectTimeout}, None)`;
  }
  return undefined;
}

function httpxClientArgs(input: GenerateInput): string {
  if (input.target !== "python.httpx") {
    return "";
  }

  const effective = firstEffective(input);
  const proxy = asString(asRecord(effective.proxy)?.url);
  const tls = asRecord(effective.tls);
  const redirects = asRecord(effective.redirects);
  const cert = certificateExpression(input.ir, tls);
  const caBundle = caBundleExpression(input.ir, tls);
  const args: string[] = [];

  if (usesHttp2(input.ir)) {
    args.push("http2=True");
  }
  if (proxy) {
    args.push(`proxy=${pythonString(proxy)}`);
  }
  if (tls?.verify === false) {
    args.push("verify=False");
  } else if (caBundle) {
    args.push(`verify=${pythonString(caBundle)}`);
  }
  if (cert) {
    args.push(`cert=${cert}`);
  }
  if (typeof redirects?.max === "number") {
    args.push(`max_redirects=${redirects.max}`);
  }
  if (usesDebug(input.ir)) {
    args.push('event_hooks={"request": [log_request], "response": [log_response]}');
  }

  return args.join(", ");
}

function renderPythonRequestBlock(
  input: GenerateInput,
  transfer: JsonRecord | undefined,
  index: number,
  multi: boolean,
  awaitRequest = false,
): string[] {
  const ir = input.ir;
  const library = pythonLibrary(input);
  const effective = asRecord(transfer?.effective) ?? {};
  const method = asString(asRecord(effective.method)?.value) ?? "GET";
  const body = asRecord(effective.body);
  const bodyKind = asString(body?.kind);
  const bodyValue = asString(body?.value) ?? "";
  const authRecord = asRecord(effective.auth);
  const auth = asString(authRecord?.value);
  const authScheme = asString(authRecord?.scheme);
  const proxyRecord = asRecord(effective.proxy);
  const proxy = asString(proxyRecord?.url);
  const noProxy = asString(proxyRecord?.noProxy);
  const tls = asRecord(effective.tls);
  const redirects = asRecord(effective.redirects);
  const timeouts = asRecord(effective.timeouts);
  const headers = headerEntries(effective);
  const externalHeaders = externalHeaderRefs(ir, effective);
  const cookieValue = inlineCookieValue(effective);
  const jarRef = cookieJarRef(ir, effective);
  const jarArgument = cookieJarArgument(input, jarRef);
  const connectTimeout = secondsFromMilliseconds(timeouts?.connectTimeoutMs);
  const maxTime = secondsFromMilliseconds(timeouts?.maxTimeMs);
  const cert = certificateExpression(ir, tls);
  const caBundle = caBundleExpression(ir, tls);
  const jsonBody = jsonBodyFromBody(bodyKind, bodyValue);
  const externalBody = bodyExternalRef(ir, body);
  const externalBodyRead = pythonExternalRead(input, externalBody);
  const requestMethod = jsonBody !== undefined && method === "GET" ? "POST" : method;
  const urlName = variableName("url", index, multi);
  const headersName = variableName("headers", index, multi);
  const kwargsName = variableName("request_kwargs", index, multi);
  const responseName = variableName("response", index, multi);
  const uploadName = variableName("upload_file", index, multi);
  const lines = [
    `    ${urlName} = ${pythonString(asString(transfer?.url) ?? "")}`,
    `    ${headersName} = ${pythonDict(headers)}`,
    `    ${kwargsName} = {`,
    `        "headers": ${headersName},`,
    "    }",
  ];

  for (const ref of externalHeaders) {
    const text = pythonExternalText(input, ref);
    if (text) {
      lines.push(`    ${headersName}.update(parse_header_lines(${text}))`);
    }
  }

  if (bodyKind === "json" && externalBodyRead) {
    lines.push(`    ${headersName}.setdefault("content-type", "application/json")`);
    lines.push(`    ${kwargsName}["data"] = ${externalBodyRead}`);
  } else if (externalBodyRead && (bodyKind === "form" || bodyKind === "form-string")) {
    const [name, value] = splitFormValue(bodyValue);
    if (value.startsWith("<")) {
      lines.push(
        `    ${kwargsName}["files"] = ${pythonDict([[name, `(None, ${externalBodyRead}.decode())`]])}`,
      );
    } else {
      lines.push(
        `    ${kwargsName}["files"] = ${pythonDict([[
          name,
          `(${pythonString(externalFileName(externalBody))}, ${externalBodyRead})`,
        ]])}`,
      );
    }
  } else if (externalBodyRead) {
    lines.push(`    ${kwargsName}["data"] = ${externalBodyRead}`);
  } else if (jsonBody !== undefined) {
    lines.push(`    ${kwargsName}["json"] = ${pythonLiteral(jsonBody)}`);
  } else if (bodyKind === "form" || bodyKind === "form-string") {
    const [name, value] = splitFormValue(bodyValue);
    lines.push(`    ${kwargsName}["files"] = ${pythonDict([[name, `(None, ${pythonString(value)})`]])}`);
  } else if (bodyKind === "upload-file") {
    lines.push(`    ${uploadName} = None`);
  } else if (bodyKind) {
    lines.push(`    ${kwargsName}["data"] = ${pythonString(bodyValue)}`);
  }

  if (auth) {
    const [username, password = ""] = auth.split(":", 2);
    if (authScheme === "digest") {
      const authClass = library === "httpx" ? "httpx.DigestAuth" : "requests.auth.HTTPDigestAuth";
      lines.push(`    ${kwargsName}["auth"] = ${authClass}(${pythonString(username)}, ${pythonString(password)})`);
    } else {
      lines.push(
        `    ${kwargsName}["auth"] = (${pythonString(username)}, ${pythonString(password)})`,
      );
    }
  }
  if (cookieValue) {
    lines.push(`    ${kwargsName}["cookies"] = ${pythonDict(cookieEntries(cookieValue))}`);
  }
  if (jarArgument) {
    lines.push(`    session.cookies.update(load_cookie_jar(${jarArgument}))`);
  }
  if (proxy && library === "requests") {
    lines.push(
      `    ${kwargsName}["proxies"] = {"http": ${pythonString(proxy)}, "https": ${pythonString(proxy)}}`,
    );
    if (noProxy) {
      lines.push(`    ${kwargsName}["proxies"]["no_proxy"] = ${pythonString(noProxy)}`);
    }
  }
  if (library === "requests" && tls?.verify === false) {
    lines.push(`    ${kwargsName}["verify"] = False`);
  } else if (library === "requests" && caBundle) {
    lines.push(`    ${kwargsName}["verify"] = ${pythonString(caBundle)}`);
  }
  if (library === "requests" && cert) {
    lines.push(`    ${kwargsName}["cert"] = ${cert}`);
  }
  {
    const timeout = timeoutExpression(library, connectTimeout, maxTime);
    if (timeout) {
      lines.push(`    ${kwargsName}["timeout"] = ${timeout}`);
    }
  }
  if (library === "requests" && typeof redirects?.max === "number") {
    lines.push(`    session.max_redirects = ${redirects.max}`);
  }
  lines.push(
    `    ${kwargsName}[${pythonString(library === "httpx" ? "follow_redirects" : "allow_redirects")}] = ${redirects?.follow === true ? "True" : "False"}`,
  );

  const requestLine = `${responseName} = ${awaitRequest ? "await " : ""}session.request(${pythonString(requestMethod)}, ${urlName}, **${kwargsName})`;
  if (bodyKind === "upload-file") {
    lines.push("    try:");
    lines.push(`        ${uploadName} = open(${pythonString(bodyValue)}, "rb")`);
    lines.push(`        ${kwargsName}["data"] = ${uploadName}`);
    lines.push(`        ${requestLine}`);
    lines.push("    finally:");
    lines.push(`        if ${uploadName} is not None:`);
    lines.push(`            ${uploadName}.close()`);
  } else {
    lines.push(`    ${requestLine}`);
  }
  lines.push(
    `    ${responseName}.raise_for_status()`,
    `    print(${responseName}.text)`,
    "",
  );
  return lines;
}

function renderPythonRequestsMain(input: GenerateInput): string {
  const transfers = transferRecords(input.ir);
  const renderTransfers = transfers.length > 0 ? transfers : [undefined];
  const multi = renderTransfers.length > 1;
  const library = pythonLibrary(input);
  const style = pythonStyle(input);
  const clientArgs = library === "httpx" ? httpxClientArgs(input) : "";
  const inlineExternalHelpers = needsInlineExternalHelpers(input);
  const inlineCookieJar = inlineExternalHelpers;
  const debugHooks = library === "httpx" && usesDebug(input.ir);
  const indent = (linesToIndent: string[]) =>
    linesToIndent.map((line) => line.length > 0 ? `    ${line}` : line);
  const lines = [
    "from http.cookiejar import MozillaCookieJar",
    "from pathlib import Path",
    ...(style === "async" ? ["import asyncio"] : []),
    "import sys",
    "",
    `import ${library}`,
    "",
    "",
    "def load_cookie_jar(path):",
    ...(inlineCookieJar
      ? [
          "    raise RuntimeError(f\"External cookie jar {path} must be provided by the caller\")",
        ]
      : [
          "    jar = MozillaCookieJar()",
          "    jar.load(path, ignore_discard=True, ignore_expires=True)",
          "    return jar",
        ]),
    "",
    "",
    "def parse_header_lines(text):",
    "    headers = {}",
    "    for line in text.splitlines():",
    "        if not line.strip() or line.lstrip().startswith(\"#\"):",
    "            continue",
    "        name, separator, value = line.partition(\":\")",
    "        if separator and name:",
    "            headers[name] = value.lstrip()",
    "    return headers",
    "",
    "",
    ...(inlineExternalHelpers
      ? [
          "def load_external_bytes(ref_id):",
          "    raise RuntimeError(f\"External reference {ref_id} must be provided by the caller\")",
          "",
          "",
          "def load_external_text(ref_id):",
          "    return load_external_bytes(ref_id).decode()",
          "",
          "",
        ]
      : []),
    ...(debugHooks
      ? [
          `${style === "async" ? "async " : ""}def log_request(request):`,
          "    print(f\"> {request.method} {request.url}\", file=sys.stderr)",
          "",
          "",
          `${style === "async" ? "async " : ""}def log_response(response):`,
          "    print(f\"< {response.status_code} {response.reason_phrase}\", file=sys.stderr)",
          "",
          "",
        ]
      : []),
    `${style === "async" ? "async " : ""}def main():`,
  ];

  if (library === "httpx") {
    const clientClass = style === "async" ? "AsyncClient" : "Client";
    const context = style === "async" ? "async with" : "with";
    lines.push(`    ${context} httpx.${clientClass}(${clientArgs}) as session:`);
    for (const [index, transfer] of renderTransfers.entries()) {
      lines.push(...indent(renderPythonRequestBlock(
        input,
        transfer,
        index,
        multi,
        style === "async",
      )));
    }
  } else {
    lines.push(`    session = requests.Session()`);
    for (const [index, transfer] of renderTransfers.entries()) {
      lines.push(...renderPythonRequestBlock(input, transfer, index, multi));
    }
  }

  lines.push(
    "if __name__ == \"__main__\":",
    style === "async" ? "    asyncio.run(main())" : "    main()",
    "",
  );
  return lines.join("\n");
}

export function applyPythonRequestsGenerator(
  input: GenerateInput,
  output: GenerateOutput,
): GenerateOutput {
  const files: GeneratedFile[] = [
    {
      path: "main.py",
      role: "main",
      content: renderPythonRequestsMain(input),
    },
  ];
  return {
    ...output,
    files,
  };
}
