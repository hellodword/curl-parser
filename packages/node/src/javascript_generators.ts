import type {
  CurlIr,
  GenerateInput,
  GenerateOutput,
  GeneratedFile,
} from "./types.js";

type JsonRecord = Record<string, unknown>;

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

function externalReadExpression(ref: JsonRecord | undefined): string | undefined {
  if (!ref) {
    return undefined;
  }
  if (ref.kind === "stdin") {
    return "await readFile(0)";
  }
  const value = asString(ref.value);
  return value ? `await readFile(${js(value)})` : undefined;
}

function externalTextExpression(ref: JsonRecord | undefined): string | undefined {
  const read = externalReadExpression(ref);
  return read ? `(${read}).toString()` : undefined;
}

function externalTextReadExpression(ref: JsonRecord | undefined): string | undefined {
  if (!ref) {
    return undefined;
  }
  if (ref.kind === "stdin") {
    return "await readFile(0, \"utf8\")";
  }
  const value = asString(ref.value);
  return value ? `await readFile(${js(value)}, "utf8")` : undefined;
}

function externalHelperBytesExpression(ref: JsonRecord | undefined): string | undefined {
  const id = asString(ref?.id);
  return id ? `await loadExternalBytes(${js(id)})` : undefined;
}

function externalHelperTextExpression(ref: JsonRecord | undefined): string | undefined {
  const id = asString(ref?.id);
  return id ? `await loadExternalText(${js(id)})` : undefined;
}

function externalFileName(ref: JsonRecord | undefined): string {
  const value = asString(ref?.value) ?? "upload";
  return value.split(/[\\/]/u).filter(Boolean).at(-1) || "upload";
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

function js(value: unknown): string {
  return JSON.stringify(value);
}

function headerPairs(effective: JsonRecord): Array<[string, string]> {
  return asArray(effective.headers)
    .map((value) => {
      const header = asRecord(value);
      const name = asString(header?.name);
      const fieldValue = asString(header?.value);
      return name && fieldValue !== undefined ? ([name, fieldValue] as [string, string]) : undefined;
    })
    .filter((value): value is [string, string] => Array.isArray(value));
}

function externalHeaderRefs(ir: CurlIr, effective: JsonRecord): JsonRecord[] {
  return asArray(effective.headers)
    .map((value) => externalRefById(ir, asString(asRecord(value)?.externalRefId)))
    .filter((value): value is JsonRecord => Boolean(value));
}

function pushFetchExternalHeaderLines(
  lines: string[],
  headersName: string,
  refs: JsonRecord[],
  useExternalHelpers: boolean,
): void {
  for (const ref of refs) {
    const text = useExternalHelpers
      ? externalHelperTextExpression(ref)
      : externalTextReadExpression(ref);
    if (!text) {
      continue;
    }
    lines.push(`for (const line of (${text}).split(/\\r?\\n/u)) {`);
    lines.push("  if (!line.trim() || line.trimStart().startsWith(\"#\")) continue;");
    lines.push("  const index = line.indexOf(\":\");");
    lines.push("  if (index <= 0) continue;");
    lines.push(`  ${headersName}.append(line.slice(0, index), line.slice(index + 1).trimStart());`);
    lines.push("}");
  }
}

function pushObjectExternalHeaderLines(lines: string[], headersName: string, refs: JsonRecord[]): void {
  for (const ref of refs) {
    const text = externalTextReadExpression(ref);
    if (!text) {
      continue;
    }
    lines.push(`for (const line of (${text}).split(/\\r?\\n/u)) {`);
    lines.push("  if (!line.trim() || line.trimStart().startsWith(\"#\")) continue;");
    lines.push("  const index = line.indexOf(\":\");");
    lines.push("  if (index <= 0) continue;");
    lines.push(`  ${headersName}[line.slice(0, index)] = line.slice(index + 1).trimStart();`);
    lines.push("}");
  }
}

function inlineCookieHeader(effective: JsonRecord): string | undefined {
  return asArray(effective.cookies)
    .map((value) => asString(asRecord(value)?.value))
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("; ") || undefined;
}

function splitFormValue(value: string): [string, string] {
  const equal = value.indexOf("=");
  if (equal < 0) {
    return [value || "field", ""];
  }
  return [value.slice(0, equal) || "field", value.slice(equal + 1)];
}

function pushFormBodyLines(
  lines: string[],
  bodyValue: string,
  externalBody: JsonRecord | undefined,
  externalBodyRead = externalReadExpression(externalBody),
  externalBodyText = externalTextExpression(externalBody),
): void {
  const [name, value] = splitFormValue(bodyValue);
  if (!externalBody) {
    lines.push("  body: (() => {");
    lines.push("    const form = new FormData();");
    lines.push(`    form.append(${js(name)}, ${js(value)});`);
    lines.push("    return form;");
    lines.push("  })(),");
    return;
  }

  lines.push("  body: await (async () => {");
  lines.push("    const form = new FormData();");
  if (value.startsWith("<")) {
    const text = externalBodyText ?? js("");
    lines.push(`    form.append(${js(name)}, ${text});`);
  } else {
    const read = externalBodyRead ?? "new Uint8Array()";
    lines.push(
      `    form.append(${js(name)}, new Blob([${read}]), ${js(externalFileName(externalBody))});`,
    );
  }
  lines.push("    return form;");
  lines.push("  })(),");
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

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function fetchTimeoutMilliseconds(effective: JsonRecord): number | undefined {
  const timeouts = asRecord(effective.timeouts);
  return asNumber(timeouts?.maxTimeMs) ?? asNumber(timeouts?.connectTimeoutMs);
}

function fetchRedirectMode(effective: JsonRecord): "follow" | "manual" {
  const redirects = asRecord(effective.redirects);
  return redirects?.follow === true ? "follow" : "manual";
}

function hasObjectFields(value: unknown): value is JsonRecord {
  return Boolean(asRecord(value) && Object.keys(value as JsonRecord).length > 0);
}

function refValue(ir: CurlIr, id: unknown): string | undefined {
  return asString(externalRefById(ir, asString(id))?.value);
}

function refReadExpressionById(ir: CurlIr, id: unknown): string | undefined {
  const value = refValue(ir, id);
  return value ? `await readFile(${js(value)})` : undefined;
}

function propertyKey(name: string): string {
  return /^[A-Za-z_$][\w$]*$/u.test(name) ? name : js(name);
}

type ExpressionEntry = [string, string];

function pushExpressionObject(
  lines: string[],
  entries: ExpressionEntry[],
  indent: string,
  suffix = ",",
): void {
  lines.push(`${indent}{`);
  for (const [name, expression] of entries) {
    lines.push(`${indent}  ${propertyKey(name)}: ${expression},`);
  }
  lines.push(`${indent}}${suffix}`);
}

function pushNamedExpressionObject(
  lines: string[],
  name: string,
  entries: ExpressionEntry[],
  indent: string,
): void {
  lines.push(`${indent}${propertyKey(name)}: {`);
  for (const [entryName, expression] of entries) {
    lines.push(`${indent}  ${propertyKey(entryName)}: ${expression},`);
  }
  lines.push(`${indent}},`);
}

function tlsExpressionEntries(ir: CurlIr, tls: JsonRecord | undefined): ExpressionEntry[] {
  if (!tls) {
    return [];
  }
  const entries: ExpressionEntry[] = [];
  const ca = refReadExpressionById(ir, tls.caFileRefId) ?? (asString(tls.caBundle) ? js(tls.caBundle) : undefined);
  const cert = refReadExpressionById(ir, tls.clientCertRefId) ??
    (asString(tls.clientCert) ? js(tls.clientCert) : undefined);
  const key = refReadExpressionById(ir, tls.clientKeyRefId) ??
    (asString(tls.clientKey) ? js(tls.clientKey) : undefined);
  if (tls.verify === false) {
    entries.push(["rejectUnauthorized", "false"]);
  }
  if (ca) {
    entries.push(["ca", ca]);
  }
  if (cert) {
    entries.push(["cert", cert]);
  }
  if (key) {
    entries.push(["key", key]);
  }
  return entries;
}

function proxyHeaderEntries(proxy: JsonRecord | undefined): ExpressionEntry[] {
  return asArray(proxy?.headers)
    .map((value) => {
      const header = asRecord(value);
      const name = asString(header?.name);
      const fieldValue = asString(header?.value);
      return name && fieldValue !== undefined ? ([name, js(fieldValue)] as ExpressionEntry) : undefined;
    })
    .filter((value): value is ExpressionEntry => Array.isArray(value));
}

function proxyUrlWithProtocol(proxy: JsonRecord): string | undefined {
  const raw = asString(proxy.url);
  if (!raw) {
    return undefined;
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(raw)) {
    return raw;
  }
  const mode = asString(proxy.mode) ?? "";
  if (mode.startsWith("socks")) {
    return `socks5://${raw}`;
  }
  return `http://${raw}`;
}

function proxyUrlParts(proxy: JsonRecord): URL | undefined {
  const value = proxyUrlWithProtocol(proxy);
  if (!value) {
    return undefined;
  }
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function proxyAuthValue(proxy: JsonRecord): string | undefined {
  const auth = asString(asRecord(proxy.auth)?.value);
  if (auth) {
    return auth;
  }
  const url = proxyUrlParts(proxy);
  if (!url || (!url.username && !url.password)) {
    return undefined;
  }
  return `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
}

function sanitizedProxyUri(proxy: JsonRecord): string | undefined {
  const url = proxyUrlParts(proxy);
  if (!url) {
    return proxyUrlWithProtocol(proxy);
  }
  if (url.protocol === "socks5h:") {
    url.protocol = "socks5:";
  }
  url.username = "";
  url.password = "";
  if (url.pathname === "/" && !url.search && !url.hash) {
    return `${url.protocol}//${url.host}`;
  }
  return url.toString();
}

function proxyIsSocks5(proxy: JsonRecord): boolean {
  const mode = asString(proxy.mode) ?? "";
  const protocol = proxyUrlParts(proxy)?.protocol ?? "";
  return mode.startsWith("socks5") || protocol === "socks5:" || protocol === "socks5h:" || protocol === "socks:";
}

function undiciTimeoutMilliseconds(effective: JsonRecord): number | undefined {
  const timeouts = asRecord(effective.timeouts);
  return asNumber(timeouts?.maxTimeMs);
}

function undiciConnectTimeoutMilliseconds(effective: JsonRecord): number | undefined {
  const timeouts = asRecord(effective.timeouts);
  return asNumber(timeouts?.connectTimeoutMs);
}

function undiciMaxRedirections(effective: JsonRecord): number | undefined {
  const redirects = asRecord(effective.redirects);
  if (typeof redirects?.max === "number") {
    return redirects.max;
  }
  return redirects?.follow === true ? 50 : undefined;
}

function axiosTimeoutMilliseconds(effective: JsonRecord): number | undefined {
  const timeouts = asRecord(effective.timeouts);
  return asNumber(timeouts?.maxTimeMs) ?? asNumber(timeouts?.connectTimeoutMs);
}

function axiosMaxRedirects(effective: JsonRecord): number {
  const redirects = asRecord(effective.redirects);
  if (redirects?.follow === true) {
    return typeof redirects.max === "number" ? redirects.max : 50;
  }
  return 0;
}

function httpVersionValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  return asString(asRecord(value)?.value);
}

function axiosProxyObjectEntries(proxy: JsonRecord | undefined): ExpressionEntry[] {
  if (!proxy || proxyIsSocks5(proxy)) {
    return [];
  }
  const url = proxyUrlParts(proxy);
  if (!url) {
    return [];
  }
  const entries: ExpressionEntry[] = [
    ["protocol", js(url.protocol.replace(/:$/u, "") || "http")],
    ["host", js(url.hostname)],
  ];
  const port = Number(url.port);
  if (Number.isInteger(port) && port > 0) {
    entries.push(["port", String(port)]);
  }
  if (proxyAuthValue(proxy)) {
    entries.push(["auth", '{ username: "REDACTED", password: "REDACTED" }']);
  }
  return entries;
}

function axiosProxyNeedsCustomAgent(proxy: JsonRecord | undefined): boolean {
  if (!proxy) {
    return false;
  }
  return proxyIsSocks5(proxy) ||
    proxyHeaderEntries(proxy).length > 0 ||
    hasObjectFields(proxy.tls);
}

function variableName(base: string, index: number, multi: boolean): string {
  return multi ? `${base}${index}` : base;
}

function renderFetchTransfer(
  input: GenerateInput,
  transfer: JsonRecord | undefined,
  index: number,
  multi: boolean,
  useExternalHelpers: boolean,
): string {
  const ir = input.ir;
  const effective = asRecord(transfer?.effective) ?? {};
  const body = asRecord(effective.body);
  const bodyKind = asString(body?.kind);
  const bodyValue = asString(body?.value) ?? "";
  const methodValue = asString(asRecord(effective.method)?.value) ?? "GET";
  const jsonBody = jsonBodyFromBody(bodyKind, bodyValue);
  const externalBody = bodyExternalRef(ir, body);
  const externalBodyRead = useExternalHelpers
    ? externalHelperBytesExpression(externalBody)
    : externalReadExpression(externalBody);
  const externalBodyText = useExternalHelpers
    ? externalHelperTextExpression(externalBody)
    : externalTextExpression(externalBody);
  const method = jsonBody !== undefined && methodValue === "GET" ? "POST" : methodValue;
  const headers = headerPairs(effective);
  const externalHeaders = externalHeaderRefs(ir, effective);
  const cookie = inlineCookieHeader(effective);
  const auth = asString(asRecord(effective.auth)?.value);
  const timeoutMs = fetchTimeoutMilliseconds(effective);
  const urlName = variableName("url", index, multi);
  const headersName = variableName("headers", index, multi);
  const initName = variableName("init", index, multi);
  const responseName = variableName("response", index, multi);
  const controllerName = variableName("controller", index, multi);
  const timeoutName = variableName("timeout", index, multi);
  const lines = [
    `const ${urlName} = ${js(asString(transfer?.url) ?? "")};`,
    `const ${headersName} = new Headers([`,
  ];

  for (const [name, value] of headers) {
    lines.push(`  [${js(name)}, ${js(value)}],`);
  }
  if (cookie) {
    lines.push(`  ["cookie", ${js(cookie)}],`);
  }
  if (auth) {
    lines.push('  ["authorization", "Basic REDACTED"],');
  }
  if (bodyKind === "json") {
    lines.push('  ["content-type", "application/json"],');
  }
  lines.push("]);");
  pushFetchExternalHeaderLines(lines, headersName, externalHeaders, useExternalHelpers);
  lines.push(
    "",
    `const ${initName} = {`,
    `  method: ${js(method)},`,
    `  headers: ${headersName},`,
    `  redirect: ${js(fetchRedirectMode(effective))},`,
  );

  if (bodyKind === "json" && externalBodyRead) {
    lines.push(`  body: ${externalBodyRead},`);
  } else if (jsonBody !== undefined) {
    lines.push(`  body: JSON.stringify(${js(jsonBody)}),`);
  } else if (bodyKind === "form" || bodyKind === "form-string") {
    pushFormBodyLines(lines, bodyValue, externalBody, externalBodyRead, externalBodyText);
  } else if (externalBodyRead) {
    lines.push(`  body: ${externalBodyRead},`);
  } else if (bodyKind) {
    lines.push(`  body: ${js(bodyValue)},`);
  }

  lines.push("};");
  if (timeoutMs !== undefined) {
    lines.push("", `const ${controllerName} = new AbortController();`);
    lines.push(`const ${timeoutName} = setTimeout(() => ${controllerName}.abort(), ${timeoutMs});`);
    lines.push(`${initName}.signal = ${controllerName}.signal;`);
  }
  lines.push("", `const ${responseName} = await fetch(${urlName}, ${initName});`);
  if (timeoutMs !== undefined) {
    lines.push(`clearTimeout(${timeoutName});`);
  }
  lines.push(
    `if (!${responseName}.ok) {`,
    `  throw new Error(\`HTTP \${${responseName}.status}\`);`,
    "}",
    `console.log(await ${responseName}.text());`,
    "",
  );
  return lines.join("\n");
}

function renderFetchMain(input: GenerateInput): string {
  const transfers = transferRecords(input.ir);
  const renderTransfers = transfers.length > 0 ? transfers : [undefined];
  const multi = renderTransfers.length > 1;
  const useExternalHelpers = input.options?.runtimeHelpers === "allow" && input.ir.externalRefs.length > 0;
  const helpers = useExternalHelpers
    ? [
        "async function loadExternalBytes(refId) {",
        "  throw new Error(`TODO: provide bytes for external reference ${refId}`);",
        "}",
        "",
        "async function loadExternalText(refId) {",
        "  throw new Error(`TODO: provide text for external reference ${refId}`);",
        "}",
        "",
      ]
    : [];
  return [
    ...helpers,
    ...renderTransfers.map((transfer, index) =>
      renderFetchTransfer(input, transfer, index, multi, useExternalHelpers),
    ),
  ].join("\n");
}

function renderUndiciTransfer(input: GenerateInput, transfer: JsonRecord | undefined, index: number, multi: boolean): string {
  const ir = input.ir;
  const effective = asRecord(transfer?.effective) ?? {};
  const body = asRecord(effective.body);
  const bodyKind = asString(body?.kind);
  const bodyValue = asString(body?.value) ?? "";
  const methodValue = asString(asRecord(effective.method)?.value) ?? "GET";
  const proxyRecord = asRecord(effective.proxy);
  const tls = asRecord(effective.tls);
  const proxyTls = asRecord(proxyRecord?.tls);
  const jsonBody = jsonBodyFromBody(bodyKind, bodyValue);
  const externalBody = bodyExternalRef(ir, body);
  const externalBodyRead = externalReadExpression(externalBody);
  const method = jsonBody !== undefined && methodValue === "GET" ? "POST" : methodValue;
  const headers = Object.fromEntries(headerPairs(effective));
  const externalHeaders = externalHeaderRefs(ir, effective);
  const cookie = inlineCookieHeader(effective);
  const auth = asString(asRecord(effective.auth)?.value);
  const timeoutMs = undiciTimeoutMilliseconds(effective);
  const connectTimeoutMs = undiciConnectTimeoutMilliseconds(effective);
  const maxRedirections = undiciMaxRedirections(effective);
  const requestTlsEntries = tlsExpressionEntries(ir, tls);
  const proxyTlsEntries = tlsExpressionEntries(ir, proxyTls);
  const proxyHeaders = proxyHeaderEntries(proxyRecord);
  const proxyAuth = proxyRecord ? proxyAuthValue(proxyRecord) : undefined;
  const proxyUri = proxyRecord ? sanitizedProxyUri(proxyRecord) : undefined;
  const usesSocksProxy = proxyRecord ? proxyIsSocks5(proxyRecord) : false;
  const needsConnectorHelper = hasObjectFields(effective.network) || hasObjectFields(effective.dns);
  const urlName = variableName("url", index, multi);
  const optionsName = variableName("options", index, multi);
  const statusName = variableName("statusCode", index, multi);
  const bodyName = variableName("body", index, multi);
  const dispatcherName = variableName("dispatcher", index, multi);
  const proxyAgentName = variableName("proxyAgent", index, multi);
  if (cookie) {
    headers.cookie = cookie;
  }
  if (auth) {
    headers.authorization = "Basic REDACTED";
  }
  if (bodyKind === "json") {
    headers["content-type"] = "application/json";
  }

  const headersName = variableName("headers", index, multi);
  const lines = [
    `const ${urlName} = ${js(asString(transfer?.url) ?? "")};`,
    `const ${headersName} = ${js(headers)};`,
  ];
  pushObjectExternalHeaderLines(lines, headersName, externalHeaders);

  if (proxyRecord && proxyUri && usesSocksProxy) {
    const socksOptions: ExpressionEntry[] = [];
    if (proxyAuth) {
      socksOptions.push(["username", js("REDACTED")], ["password", js("REDACTED")]);
    }
    if (proxyHeaders.length > 0) {
      socksOptions.push(["headers", JSON.stringify(Object.fromEntries(proxyHeaders.map(([name, value]) => [name, JSON.parse(value)])))]);
    }
    if (proxyTlsEntries.length > 0) {
      lines.push(`const ${proxyAgentName} = new Socks5ProxyAgent(${js(proxyUri)}, {`);
      for (const [name, expression] of socksOptions) {
        lines.push(`  ${propertyKey(name)}: ${expression},`);
      }
      pushNamedExpressionObject(lines, "proxyTls", proxyTlsEntries, "  ");
      lines.push("});");
    } else if (socksOptions.length > 0) {
      lines.push(`const ${proxyAgentName} = new Socks5ProxyAgent(${js(proxyUri)}, {`);
      for (const [name, expression] of socksOptions) {
        lines.push(`  ${propertyKey(name)}: ${expression},`);
      }
      lines.push("});");
    } else {
      lines.push(`const ${proxyAgentName} = new Socks5ProxyAgent(${js(proxyUri)});`);
    }
  } else if (proxyRecord && proxyUri) {
    lines.push(`const ${proxyAgentName} = new ProxyAgent({`);
    lines.push(`  uri: ${js(proxyUri)},`);
    if (proxyAuth) {
      lines.push(`  token: ${js("Basic REDACTED")},`);
    }
    if (proxyHeaders.length > 0) {
      pushNamedExpressionObject(lines, "headers", proxyHeaders, "  ");
    }
    if (proxyRecord.tunnel === true) {
      lines.push("  proxyTunnel: true,");
    }
    if (connectTimeoutMs !== undefined) {
      lines.push(`  connectTimeout: ${connectTimeoutMs},`);
    }
    if (requestTlsEntries.length > 0) {
      pushNamedExpressionObject(lines, "requestTls", requestTlsEntries, "  ");
    }
    if (proxyTlsEntries.length > 0) {
      pushNamedExpressionObject(lines, "proxyTls", proxyTlsEntries, "  ");
    }
    if (needsConnectorHelper) {
      lines.push(`  clientFactory: createUndiciConnectorClientFactory(${js({ dns: effective.dns ?? {}, network: effective.network ?? {} })}),`);
    }
    lines.push("});");
  } else if (needsConnectorHelper) {
    lines.push(
      `const ${dispatcherName} = createUndiciConnectorDispatcher(${js({ dns: effective.dns ?? {}, network: effective.network ?? {} })});`,
    );
  } else if (requestTlsEntries.length > 0 || connectTimeoutMs !== undefined) {
    lines.push(`const ${dispatcherName} = new Agent({`);
    if (connectTimeoutMs !== undefined) {
      lines.push(`  connectTimeout: ${connectTimeoutMs},`);
    }
    if (requestTlsEntries.length > 0) {
      pushNamedExpressionObject(lines, "connect", requestTlsEntries, "  ");
    }
    lines.push("});");
  }

  lines.push(
    "",
    `const ${optionsName} = {`,
    `  method: ${js(method)},`,
    `  headers: ${headersName},`,
  );

  if (bodyKind === "json" && externalBodyRead) {
    lines.push(`  body: ${externalBodyRead},`);
  } else if (jsonBody !== undefined) {
    lines.push(`  body: JSON.stringify(${js(jsonBody)}),`);
  } else if (bodyKind === "form" || bodyKind === "form-string") {
    pushFormBodyLines(lines, bodyValue, externalBody);
  } else if (externalBodyRead) {
    lines.push(`  body: ${externalBodyRead},`);
  } else if (bodyKind) {
    lines.push(`  body: ${js(bodyValue)},`);
  }
  if (timeoutMs !== undefined) {
    lines.push(`  bodyTimeout: ${timeoutMs},`);
    lines.push(`  headersTimeout: ${timeoutMs},`);
  }
  if (maxRedirections !== undefined) {
    lines.push(`  maxRedirections: ${maxRedirections},`);
  }
  if (proxyRecord && proxyUri) {
    lines.push(`  dispatcher: ${proxyAgentName},`);
  } else if (needsConnectorHelper || requestTlsEntries.length > 0 || connectTimeoutMs !== undefined) {
    lines.push(`  dispatcher: ${dispatcherName},`);
  }
  lines.push("};", "", `const { statusCode: ${statusName}, body: ${bodyName} } = await request(${urlName}, ${optionsName});`);
  lines.push(
    `if (${statusName} < 200 || ${statusName} >= 300) {`,
    `  throw new Error(\`HTTP \${${statusName}}\`);`,
    "}",
    `console.log(await ${bodyName}.text());`,
    "",
  );
  return lines.join("\n");
}

function renderUndiciMain(input: GenerateInput): string {
  const transfers = transferRecords(input.ir);
  const renderTransfers = transfers.length > 0 ? transfers : [undefined];
  const multi = renderTransfers.length > 1;
  const needsProxy = renderTransfers.some((transfer) => {
    const proxy = asRecord(asRecord(transfer?.effective)?.proxy);
    return Boolean(proxy && !proxyIsSocks5(proxy));
  });
  const needsSocksProxy = renderTransfers.some((transfer) => {
    const proxy = asRecord(asRecord(transfer?.effective)?.proxy);
    return Boolean(proxy && proxyIsSocks5(proxy));
  });
  const needsAgent = renderTransfers.some((transfer) => {
    const effective = asRecord(transfer?.effective) ?? {};
    const proxy = asRecord(effective.proxy);
    return !proxy &&
      (tlsExpressionEntries(input.ir, asRecord(effective.tls)).length > 0 ||
        undiciConnectTimeoutMilliseconds(effective) !== undefined);
  });
  const needsConnectorHelper = renderTransfers.some((transfer) => {
    const effective = asRecord(transfer?.effective) ?? {};
    return hasObjectFields(effective.network) || hasObjectFields(effective.dns);
  });
  const needsDebug = renderTransfers.some((transfer) =>
    hasObjectFields(asRecord(transfer?.effective)?.debug),
  );
  const needsReadFile = renderTransfers.some((transfer) => {
    const effective = asRecord(transfer?.effective) ?? {};
    return Boolean(bodyExternalRef(input.ir, asRecord(effective.body))) ||
      externalHeaderRefs(input.ir, effective).length > 0 ||
      tlsExpressionEntries(input.ir, asRecord(effective.tls)).some(([, expression]) => expression.includes("readFile(")) ||
      tlsExpressionEntries(input.ir, asRecord(asRecord(effective.proxy)?.tls)).some(([, expression]) =>
        expression.includes("readFile(")
      );
  });
  const undiciImports = ["request"];
  if (needsAgent) {
    undiciImports.unshift("Agent");
  }
  if (needsProxy) {
    undiciImports.unshift("ProxyAgent");
  }
  if (needsSocksProxy) {
    undiciImports.unshift("Socks5ProxyAgent");
  }
  const imports = [`import { ${undiciImports.join(", ")} } from "undici";`];
  if (needsDebug) {
    imports.push('import diagnosticsChannel from "node:diagnostics_channel";');
  }
  if (needsReadFile) {
    imports.push('import { readFile } from "node:' + 'fs/promises";');
  }
  const helpers: string[] = [];
  if (needsConnectorHelper) {
    helpers.push(
      "function createUndiciConnectorDispatcher(curlConnectorConfig) {",
      "  throw new Error(`TODO: provide an Undici dispatcher for curl DNS/network controls: ${JSON.stringify(curlConnectorConfig)}`);",
      "}",
      "",
      "function createUndiciConnectorClientFactory(curlConnectorConfig) {",
      "  return () => createUndiciConnectorDispatcher(curlConnectorConfig);",
      "}",
      "",
    );
  }
  if (needsDebug) {
    helpers.push(
      "function subscribeUndiciDiagnostics() {",
      "  for (const name of [",
      '    "undici:request:create",',
      '    "undici:request:headers",',
      '    "undici:request:error",',
      '    "undici:proxy:connected",',
      "  ]) {",
      "    diagnosticsChannel.channel(name).subscribe((message) => {",
      "      console.error(name, message);",
      "    });",
      "  }",
      "}",
      "",
      "subscribeUndiciDiagnostics();",
      "",
    );
  }
  return [
    ...imports,
    "",
    ...helpers,
    ...renderTransfers.map((transfer, index) =>
      renderUndiciTransfer(input, transfer, index, multi),
    ),
  ].join("\n");
}

function pushAxiosDataLines(
  lines: string[],
  requestName: string,
  formName: string,
  bodyKind: string | undefined,
  bodyValue: string,
  jsonBody: unknown | undefined,
  externalBody: JsonRecord | undefined,
): void {
  const externalBodyRead = externalReadExpression(externalBody);
  if (bodyKind === "json" && externalBodyRead) {
    lines.push(`${requestName}.data = ${externalBodyRead};`);
  } else if (jsonBody !== undefined) {
    lines.push(`${requestName}.data = ${js(jsonBody)};`);
  } else if (bodyKind === "form" || bodyKind === "form-string") {
    const [name, value] = splitFormValue(bodyValue);
    lines.push(`const ${formName} = new FormData();`);
    if (!externalBody) {
      lines.push(`${formName}.append(${js(name)}, ${js(value)});`);
    } else if (value.startsWith("<")) {
      const text = externalTextExpression(externalBody) ?? js("");
      lines.push(`${formName}.append(${js(name)}, ${text});`);
    } else {
      const read = externalBodyRead ?? "new Uint8Array()";
      lines.push(
        `${formName}.append(${js(name)}, new Blob([${read}]), ${js(externalFileName(externalBody))});`,
      );
    }
    lines.push(`${requestName}.data = ${formName};`);
  } else if (externalBodyRead) {
    lines.push(`${requestName}.data = ${externalBodyRead};`);
  } else if (bodyKind) {
    lines.push(`${requestName}.data = ${js(bodyValue)};`);
  }
}

function renderAxiosTransfer(input: GenerateInput, transfer: JsonRecord | undefined, index: number, multi: boolean): string {
  const ir = input.ir;
  const effective = asRecord(transfer?.effective) ?? {};
  const body = asRecord(effective.body);
  const bodyKind = asString(body?.kind);
  const bodyValue = asString(body?.value) ?? "";
  const methodValue = asString(asRecord(effective.method)?.value) ?? "GET";
  const proxyRecord = asRecord(effective.proxy);
  const tls = asRecord(effective.tls);
  const proxyTls = asRecord(proxyRecord?.tls);
  const jsonBody = jsonBodyFromBody(bodyKind, bodyValue);
  const externalBody = bodyExternalRef(ir, body);
  const method = jsonBody !== undefined && methodValue === "GET" ? "POST" : methodValue;
  const headers = Object.fromEntries(headerPairs(effective));
  const externalHeaders = externalHeaderRefs(ir, effective);
  const cookie = inlineCookieHeader(effective);
  const auth = asString(asRecord(effective.auth)?.value);
  const timeoutMs = axiosTimeoutMilliseconds(effective);
  const maxRedirects = axiosMaxRedirects(effective);
  const requestTlsEntries = tlsExpressionEntries(ir, tls);
  const proxyTlsEntries = tlsExpressionEntries(ir, proxyTls);
  const proxyHeaders = proxyHeaderEntries(proxyRecord);
  const proxyUri = proxyRecord ? sanitizedProxyUri(proxyRecord) : undefined;
  const proxyAuth = proxyRecord ? proxyAuthValue(proxyRecord) : undefined;
  const usesCustomProxyAgent = axiosProxyNeedsCustomAgent(proxyRecord);
  const proxyObjectEntries = usesCustomProxyAgent ? [] : axiosProxyObjectEntries(proxyRecord);
  const useHttp2 = httpVersionValue(effective.httpVersion) === "2" && input.options?.runtimeHelpers === "allow";
  const urlName = variableName("url", index, multi);
  const headersName = variableName("headers", index, multi);
  const requestName = variableName("requestOptions", index, multi);
  const responseName = variableName("response", index, multi);
  const formName = variableName("form", index, multi);
  const httpsAgentName = variableName("httpsAgent", index, multi);
  const proxyAgentName = variableName("proxyAgent", index, multi);
  const controllerName = variableName("controller", index, multi);
  const timeoutName = variableName("timeout", index, multi);
  if (cookie) {
    headers.cookie = cookie;
  }
  if (bodyKind === "json") {
    headers["content-type"] = "application/json";
  }

  const lines = [
    `const ${urlName} = ${js(asString(transfer?.url) ?? "")};`,
    `const ${headersName} = ${js(headers)};`,
  ];
  pushObjectExternalHeaderLines(lines, headersName, externalHeaders);
  if (requestTlsEntries.length > 0 && !usesCustomProxyAgent) {
    lines.push(`const ${httpsAgentName} = new https.Agent({`);
    for (const [name, expression] of requestTlsEntries) {
      lines.push(`  ${propertyKey(name)}: ${expression},`);
    }
    lines.push("});");
  }
  if (proxyRecord && proxyUri && usesCustomProxyAgent) {
    const helperName = proxyIsSocks5(proxyRecord) ? "createSocksProxyAgent" : "createAxiosProxyAgent";
    lines.push(`const ${proxyAgentName} = ${helperName}({`);
    lines.push(`  uri: ${js(proxyUri)},`);
    if (proxyAuth) {
      lines.push('  auth: { username: "REDACTED", password: "REDACTED" },');
    }
    if (proxyHeaders.length > 0) {
      pushNamedExpressionObject(lines, "headers", proxyHeaders, "  ");
    }
    if (proxyRecord.tunnel === true) {
      lines.push("  tunnel: true,");
    }
    if (requestTlsEntries.length > 0) {
      pushNamedExpressionObject(lines, "requestTls", requestTlsEntries, "  ");
    }
    if (proxyTlsEntries.length > 0) {
      pushNamedExpressionObject(lines, "proxyTls", proxyTlsEntries, "  ");
    }
    lines.push("});");
  }
  lines.push(
    "",
    `const ${requestName} = {`,
    `  url: ${urlName},`,
    `  method: ${js(method)},`,
    `  headers: ${headersName},`,
    `  maxRedirects: ${maxRedirects},`,
    "};",
  );

  pushAxiosDataLines(lines, requestName, formName, bodyKind, bodyValue, jsonBody, externalBody);
  if (auth) {
    lines.push(`${requestName}.auth = { username: "REDACTED", password: "REDACTED" };`);
  }
  if (timeoutMs !== undefined) {
    lines.push(`${requestName}.timeout = ${timeoutMs};`);
    lines.push(`const ${controllerName} = new AbortController();`);
    lines.push(`const ${timeoutName} = setTimeout(() => ${controllerName}.abort(), ${timeoutMs});`);
    lines.push(`${requestName}.signal = ${controllerName}.signal;`);
  }
  if (requestTlsEntries.length > 0 && !usesCustomProxyAgent) {
    lines.push(`${requestName}.httpsAgent = ${httpsAgentName};`);
  }
  if (proxyObjectEntries.length > 0) {
    lines.push(`${requestName}.proxy = {`);
    for (const [name, expression] of proxyObjectEntries) {
      lines.push(`  ${propertyKey(name)}: ${expression},`);
    }
    lines.push("};");
  }
  if (proxyRecord && usesCustomProxyAgent && proxyUri) {
    lines.push(`${requestName}.proxy = false;`);
    lines.push(`${requestName}.httpAgent = ${proxyAgentName};`);
    lines.push(`${requestName}.httpsAgent = ${proxyAgentName};`);
  }
  if (useHttp2) {
    lines.push(`${requestName}.adapter = "http";`);
    lines.push(`${requestName}.httpVersion = 2;`);
    lines.push(`${requestName}.http2Options = {};`);
  }
  lines.push("", `const ${responseName} = await axios.request(${requestName});`);
  if (timeoutMs !== undefined) {
    lines.push(`clearTimeout(${timeoutName});`);
  }
  lines.push(
    `if (${responseName}.status < 200 || ${responseName}.status >= 300) {`,
    `  throw new Error(\`HTTP \${${responseName}.status}\`);`,
    "}",
    `console.log(typeof ${responseName}.data === "string" ? ${responseName}.data : JSON.stringify(${responseName}.data));`,
    "",
  );
  return lines.join("\n");
}

function renderAxiosMain(input: GenerateInput): string {
  const transfers = transferRecords(input.ir);
  const renderTransfers = transfers.length > 0 ? transfers : [undefined];
  const multi = renderTransfers.length > 1;
  const needsReadFile = renderTransfers.some((transfer) => {
    const effective = asRecord(transfer?.effective) ?? {};
    const proxy = asRecord(effective.proxy);
    return Boolean(bodyExternalRef(input.ir, asRecord(effective.body))) ||
      externalHeaderRefs(input.ir, effective).length > 0 ||
      tlsExpressionEntries(input.ir, asRecord(effective.tls)).some(([, expression]) => expression.includes("readFile(")) ||
      tlsExpressionEntries(input.ir, asRecord(proxy?.tls)).some(([, expression]) => expression.includes("readFile("));
  });
  const needsHttpsAgent = renderTransfers.some((transfer) => {
    const effective = asRecord(transfer?.effective) ?? {};
    const proxy = asRecord(effective.proxy);
    return tlsExpressionEntries(input.ir, asRecord(effective.tls)).length > 0 &&
      !axiosProxyNeedsCustomAgent(proxy);
  });
  const needsSocksProxyHelper = renderTransfers.some((transfer) => {
    const proxy = asRecord(asRecord(transfer?.effective)?.proxy);
    return axiosProxyNeedsCustomAgent(proxy) && Boolean(proxy && proxyIsSocks5(proxy));
  });
  const needsAxiosProxyHelper = renderTransfers.some((transfer) => {
    const proxy = asRecord(asRecord(transfer?.effective)?.proxy);
    return axiosProxyNeedsCustomAgent(proxy) && Boolean(proxy && !proxyIsSocks5(proxy));
  });
  const imports = ['import axios from "axios";'];
  if (needsHttpsAgent) {
    imports.push('import https from "node:https";');
  }
  if (needsReadFile) {
    imports.push('import { readFile } from "node:' + 'fs/promises";');
  }
  const helpers: string[] = [];
  if (needsSocksProxyHelper) {
    helpers.push(
      "function createSocksProxyAgent(curlProxyConfig) {",
      "  throw new Error(`TODO: provide a socks-proxy-agent instance for ${JSON.stringify(curlProxyConfig)}`);",
      "}",
      "",
    );
  }
  if (needsAxiosProxyHelper) {
    helpers.push(
      "function createAxiosProxyAgent(curlProxyConfig) {",
      "  throw new Error(`TODO: provide an Axios-compatible proxy agent for ${JSON.stringify(curlProxyConfig)}`);",
      "}",
      "",
    );
  }
  return [
    ...imports,
    "",
    ...helpers,
    ...renderTransfers.map((transfer, index) =>
      renderAxiosTransfer(input, transfer, index, multi),
    ),
  ].join("\n");
}

export function applyJavaScriptGenerator(input: GenerateInput, output: GenerateOutput): GenerateOutput {
  const files: GeneratedFile[] =
    input.target === "js.axios"
      ? [{ path: "main.mjs", role: "main", content: renderAxiosMain(input) }]
      : input.target === "js.undici"
      ? [{ path: "main.mjs", role: "main", content: renderUndiciMain(input) }]
      : [{ path: "main.js", role: "main", content: renderFetchMain(input) }];
  return {
    ...output,
    files,
  };
}
