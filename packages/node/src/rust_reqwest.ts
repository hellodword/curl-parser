import type { GenerateInput, GenerateOutput, GeneratedFile } from "./types.js";

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

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function hasObjectFields(value: unknown): value is JsonRecord {
  const record = asRecord(value);
  return Boolean(record && Object.keys(record).length > 0);
}

function httpVersionValue(value: unknown): string | undefined {
  return asString(value) ?? asString(asRecord(value)?.value);
}

function httpVersionPolicy(value: unknown): string | undefined {
  return asString(asRecord(value)?.policy);
}

function externalRefById(input: GenerateInput, id: string | undefined): JsonRecord | undefined {
  if (!id) {
    return undefined;
  }
  return input.ir.externalRefs
    .map((value) => asRecord(value))
    .find((value) => value?.id === id);
}

function refValue(input: GenerateInput, id: unknown): string | undefined {
  return asString(externalRefById(input, asString(id))?.value);
}

function bodyExternalRef(input: GenerateInput, body: JsonRecord | undefined): JsonRecord | undefined {
  return externalRefById(input, asString(body?.externalRefId));
}

function transferRecords(input: GenerateInput): JsonRecord[] {
  const transfers: JsonRecord[] = [];
  for (const groupValue of input.ir.groups) {
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

function rustString(value: string): string {
  return JSON.stringify(value);
}

function rustRawJson(value: string): string {
  const hashCount = value.includes("\"#") ? 2 : 1;
  const hashes = "#".repeat(hashCount);
  return `r${hashes}"${value}"${hashes}`;
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

function externalHeaderRefs(input: GenerateInput, effective: JsonRecord): JsonRecord[] {
  return asArray(effective.headers)
    .map((value) => externalRefById(input, asString(asRecord(value)?.externalRefId)))
    .filter((value): value is JsonRecord => Boolean(value));
}

function inlineCookieHeader(effective: JsonRecord): string | undefined {
  return asArray(effective.cookies)
    .map((value) => asString(asRecord(value)?.value))
    .filter((value): value is string => typeof value === "string" && value.includes("="))
    .join("; ") || undefined;
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

function timeoutMillis(effective: JsonRecord): number | undefined {
  return asNumber(asRecord(effective.timeouts)?.maxTimeMs);
}

function connectTimeoutMillis(effective: JsonRecord): number | undefined {
  return asNumber(asRecord(effective.timeouts)?.connectTimeoutMs);
}

function redirectLimit(effective: JsonRecord): number {
  const redirects = asRecord(effective.redirects);
  if (redirects?.follow === true) {
    return typeof redirects.max === "number" ? redirects.max : 50;
  }
  return 0;
}

function tlsCaPath(input: GenerateInput, tls: JsonRecord | undefined): string | undefined {
  return refValue(input, tls?.caFileRefId);
}

function tlsClientCertPath(input: GenerateInput, tls: JsonRecord | undefined): string | undefined {
  return refValue(input, tls?.clientCertRefId) ?? asString(tls?.clientCert);
}

function tlsClientKeyPath(input: GenerateInput, tls: JsonRecord | undefined): string | undefined {
  return refValue(input, tls?.clientKeyRefId);
}

function needsConnectorHelper(effective: JsonRecord): boolean {
  return hasObjectFields(effective.network) || hasObjectFields(effective.dns);
}

function proxyMode(proxy: JsonRecord | undefined): string {
  return asString(proxy?.mode) ?? "";
}

function proxyIsSocks(proxy: JsonRecord | undefined): boolean {
  const mode = proxyMode(proxy);
  const url = asString(proxy?.url) ?? "";
  return mode.startsWith("socks") || /^socks(?:4a?|5h?)?:/iu.test(url);
}

function usesHttp2(input: GenerateInput): boolean {
  return transferRecords(input).some((transfer) =>
    httpVersionValue(asRecord(transfer.effective)?.httpVersion) === "2",
  );
}

function usesSocks(input: GenerateInput): boolean {
  return transferRecords(input).some((transfer) =>
    proxyIsSocks(asRecord(asRecord(transfer.effective)?.proxy)),
  );
}

function needsHelperModule(input: GenerateInput): boolean {
  return transferRecords(input).some((transfer) => {
    const effective = asRecord(transfer.effective) ?? {};
    const tls = asRecord(effective.tls);
    return Boolean(tlsCaPath(input, tls)) ||
      Boolean(tlsClientCertPath(input, tls)) ||
      needsConnectorHelper(effective);
  });
}

function renderCargoToml(input: GenerateInput): string {
  const features = ["blocking", "cookies", "json", "multipart", "rustls-tls"];
  if (usesHttp2(input)) {
    features.push("http2");
  }
  if (usesSocks(input)) {
    features.push("socks");
  }
  return [
    "[package]",
    'name = "generated-curl-request"',
    'version = "0.1.0"',
    'edition = "2021"',
    "",
    "[dependencies]",
    `reqwest = { version = "0.12", features = [${features.map((feature) => rustString(feature)).join(", ")}] }`,
    'serde_json = "1"',
    'tokio = { version = "1", features = ["macros", "rt-multi-thread"] }',
    "",
    "[[bin]]",
    'name = "blocking"',
    'path = "src/main.rs"',
    "",
    "[[bin]]",
    'name = "async"',
    'path = "src/async_main.rs"',
    "",
  ].join("\n");
}

function renderHelperModule(): string {
  return [
    "pub fn load_root_certificates(path: &str) -> Result<Vec<reqwest::Certificate>, Box<dyn std::error::Error>> {",
    "    let bytes = std::fs::read(path)?;",
    "    Ok(reqwest::Certificate::from_pem_bundle(&bytes)?)",
    "}",
    "",
    "pub fn load_identity(",
    "    cert_path: &str,",
    "    key_path: Option<&str>,",
    ") -> Result<reqwest::Identity, Box<dyn std::error::Error>> {",
    "    let mut pem = std::fs::read(cert_path)?;",
    "    if let Some(key_path) = key_path {",
    "        pem.extend_from_slice(b\"\\n\");",
    "        pem.extend_from_slice(&std::fs::read(key_path)?);",
    "    }",
    "    Ok(reqwest::Identity::from_pem(&pem)?)",
    "}",
    "",
    "pub fn configure_async_connector(",
    "    builder: reqwest::ClientBuilder,",
    "    curl_connector_config: &str,",
    ") -> Result<reqwest::ClientBuilder, Box<dyn std::error::Error>> {",
    "    let _ = builder;",
    "    Err(std::io::Error::new(",
    "        std::io::ErrorKind::Unsupported,",
    "        format!(",
    "            \"TODO: provide reqwest connector/resolver for curl DNS/network controls: {}\",",
    "            curl_connector_config,",
    "        ),",
    "    )",
    "    .into())",
    "}",
    "",
    "pub fn configure_blocking_connector(",
    "    builder: reqwest::blocking::ClientBuilder,",
    "    curl_connector_config: &str,",
    ") -> Result<reqwest::blocking::ClientBuilder, Box<dyn std::error::Error>> {",
    "    let _ = builder;",
    "    Err(std::io::Error::new(",
    "        std::io::ErrorKind::Unsupported,",
    "        format!(",
    "            \"TODO: provide reqwest blocking connector/resolver for curl DNS/network controls: {}\",",
    "            curl_connector_config,",
    "        ),",
    "    )",
    "    .into())",
    "}",
    "",
  ].join("\n");
}

function renderRequestSetup(
  input: GenerateInput,
  transfer: JsonRecord | undefined,
  asyncMode: boolean,
): string[] {
  const effective = asRecord(transfer?.effective) ?? {};
  const body = asRecord(effective.body);
  const bodyKind = asString(body?.kind);
  const bodyValue = asString(body?.value) ?? "";
  const externalBody = bodyExternalRef(input, body);
  const jsonBody = bodyKind === "json" ? bodyValue : undefined;
  const externalHeaders = externalHeaderRefs(input, effective);
  const methodValue = asString(asRecord(effective.method)?.value) ?? "GET";
  const method = jsonBody && methodValue === "GET" ? "POST" : methodValue;
  const cookie = inlineCookieHeader(effective);
  const auth = asString(asRecord(effective.auth)?.value);
  const lines = [
    `    let mut request = client.request(reqwest::Method::from_bytes(${rustString(method)}.as_bytes())?, ${rustString(asString(transfer?.url) ?? "")});`,
  ];

  for (const [name, value] of headerPairs(effective)) {
    lines.push(`    request = request.header(${rustString(name)}, ${rustString(value)});`);
  }
  for (const [index, ref] of externalHeaders.entries()) {
    if (ref.kind === "stdin") {
      lines.push(`    let mut external_headers_${index} = String::new();`);
      lines.push(`    std::io::Read::read_to_string(&mut std::io::stdin(), &mut external_headers_${index})?;`);
    } else {
      lines.push(`    let external_headers_${index} = std::fs::read_to_string(${rustString(asString(ref.value) ?? "")})?;`);
    }
    lines.push(`    for line in external_headers_${index}.lines() {`);
    lines.push("        let trimmed = line.trim();");
    lines.push("        if trimmed.is_empty() || trimmed.starts_with('#') {");
    lines.push("            continue;");
    lines.push("        }");
    lines.push("        if let Some((name, value)) = line.split_once(':') {");
    lines.push("            if !name.trim().is_empty() {");
    lines.push("                request = request.header(name.trim(), value.trim_start());");
    lines.push("            }");
    lines.push("        }");
    lines.push("    }");
  }
  if (cookie) {
    lines.push(`    request = request.header(reqwest::header::COOKIE, ${rustString(cookie)});`);
  }
  if (auth) {
    lines.push("    request = request.header(reqwest::header::AUTHORIZATION, \"Basic REDACTED\");");
  }
  if (externalBody && (bodyKind === "form" || bodyKind === "form-string")) {
    const [name, value] = splitFormValue(bodyValue);
    const multipart = asyncMode ? "reqwest::multipart::Form" : "reqwest::blocking::multipart::Form";
    const partType = asyncMode ? "reqwest::multipart::Part" : "reqwest::blocking::multipart::Part";
    if (value.startsWith("<")) {
      lines.push(`    let form_text = std::fs::read_to_string(${rustString(asString(externalBody.value) ?? "")})?;`);
      lines.push(`    let form = ${multipart}::new().text(${rustString(name)}, form_text);`);
    } else {
      lines.push(`    let form_bytes = std::fs::read(${rustString(asString(externalBody.value) ?? "")})?;`);
      lines.push(`    let part = ${partType}::bytes(form_bytes).file_name(${rustString(externalFileName(externalBody))});`);
      lines.push(`    let form = ${multipart}::new().part(${rustString(name)}, part);`);
    }
    lines.push("    request = request.multipart(form);");
  } else if (externalBody) {
    if (externalBody.kind === "stdin") {
      lines.push("    let mut external_body = Vec::new();");
      lines.push("    let mut stdin = std::io::stdin();");
      lines.push("    std::io::Read::read_to_end(&mut stdin, &mut external_body)?;");
      lines.push("    request = request.body(external_body);");
    } else {
      lines.push(`    let external_body = std::fs::read(${rustString(asString(externalBody.value) ?? "")})?;`);
      lines.push("    request = request.body(external_body);");
    }
    if (bodyKind === "json") {
      lines.push("    request = request.header(reqwest::header::CONTENT_TYPE, \"application/json\");");
    }
  } else if (jsonBody) {
    lines.push(`    let json_body: serde_json::Value = serde_json::from_str(${rustRawJson(jsonBody)})?;`);
    lines.push("    request = request.json(&json_body);");
  } else if (bodyKind === "form" || bodyKind === "form-string") {
    const [name, value] = splitFormValue(bodyValue);
    const multipart = asyncMode ? "reqwest::multipart::Form" : "reqwest::blocking::multipart::Form";
    lines.push(`    let form = ${multipart}::new().text(${rustString(name)}, ${rustString(value)});`);
    lines.push("    request = request.multipart(form);");
  } else if (bodyKind === "upload-file") {
    lines.push(`    let upload = std::fs::read(${rustString(bodyValue)})?;`);
    lines.push("    request = request.body(upload);");
  } else if (bodyKind) {
    lines.push(`    request = request.body(${rustString(bodyValue)});`);
  }
  return lines;
}

function renderClientBuilder(input: GenerateInput, transfer: JsonRecord | undefined, asyncMode: boolean): string[] {
  const effective = asRecord(transfer?.effective) ?? {};
  const proxyRecord = asRecord(effective.proxy);
  const proxy = asString(proxyRecord?.url);
  const noProxy = asString(proxyRecord?.noProxy);
  const proxyAuth = asString(asRecord(proxyRecord?.auth)?.value);
  const proxyHeaders = asArray(proxyRecord?.headers)
    .map((value) => {
      const header = asRecord(value);
      const name = asString(header?.name);
      const fieldValue = asString(header?.value);
      return name && fieldValue !== undefined ? ([name, fieldValue] as [string, string]) : undefined;
    })
    .filter((value): value is [string, string] => Array.isArray(value));
  const tls = asRecord(effective.tls);
  const timeout = timeoutMillis(effective);
  const connectTimeout = connectTimeoutMillis(effective);
  const redirects = redirectLimit(effective);
  const httpVersion = httpVersionValue(effective.httpVersion);
  const httpPolicy = httpVersionPolicy(effective.httpVersion);
  const caPath = tlsCaPath(input, tls);
  const certPath = tlsClientCertPath(input, tls);
  const keyPath = tlsClientKeyPath(input, tls);
  const connectorHelper = needsConnectorHelper(effective);
  const debug = hasObjectFields(effective.debug);
  const lines = [`    let mut builder = ${asyncMode ? "reqwest::Client::builder()" : "reqwest::blocking::Client::builder()"};`];
  if (proxy) {
    lines.push(`    let mut proxy = reqwest::Proxy::all(${rustString(proxy)})?;`);
    if (proxyAuth) {
      lines.push('    proxy = proxy.basic_auth("REDACTED", "REDACTED");');
    }
    if (noProxy) {
      lines.push(`    proxy = proxy.no_proxy(reqwest::NoProxy::from_string(${rustString(noProxy)}));`);
    }
    if (proxyHeaders.length > 0) {
      lines.push("    let mut proxy_headers = reqwest::header::HeaderMap::new();");
      for (const [name, value] of proxyHeaders) {
        lines.push(`    proxy_headers.insert(${rustString(name)}, ${rustString(value)}.parse()?);`);
      }
      lines.push("    proxy = proxy.headers(proxy_headers);");
    }
    lines.push("    builder = builder.proxy(proxy);");
  }
  if (tls?.verify === false) {
    lines.push("    builder = builder.danger_accept_invalid_certs(true); // curl -k: unsafe outside controlled replay");
  }
  if (caPath) {
    lines.push(`    for certificate in helper::load_root_certificates(${rustString(caPath)})? {`);
    lines.push("        builder = builder.add_root_certificate(certificate);");
    lines.push("    }");
  }
  if (certPath) {
    lines.push(
      `    builder = builder.identity(helper::load_identity(${rustString(certPath)}, ${keyPath ? `Some(${rustString(keyPath)})` : "None"})?);`,
    );
  }
  if (redirects === 0) {
    lines.push("    builder = builder.redirect(reqwest::redirect::Policy::none());");
  } else {
    lines.push(`    builder = builder.redirect(reqwest::redirect::Policy::limited(${redirects}));`);
  }
  if (timeout !== undefined) {
    lines.push(`    builder = builder.timeout(std::time::Duration::from_millis(${timeout}));`);
  }
  if (connectTimeout !== undefined) {
    lines.push(`    builder = builder.connect_timeout(std::time::Duration::from_millis(${connectTimeout}));`);
  }
  if (httpVersion === "2" && httpPolicy === "prior-knowledge") {
    lines.push("    builder = builder.http2_prior_knowledge();");
  }
  if (debug) {
    lines.push("    builder = builder.connection_verbose(true);");
  }
  if (connectorHelper) {
    const helperName = asyncMode ? "configure_async_connector" : "configure_blocking_connector";
    lines.push(
      `    builder = helper::${helperName}(builder, ${rustRawJson(JSON.stringify({ dns: effective.dns ?? {}, network: effective.network ?? {} }))})?;`,
    );
  }
  return lines;
}

function indentRust(lines: string[]): string[] {
  return lines.map((line) => (line ? `    ${line}` : line));
}

function renderRequestBlock(
  input: GenerateInput,
  transfer: JsonRecord | undefined,
  asyncMode: boolean,
): string[] {
  const builder = renderClientBuilder(input, transfer, asyncMode);
  const request = renderRequestSetup(input, transfer, asyncMode);
  return [
    "    {",
    ...indentRust(builder),
    "        let client = builder.build()?;",
    ...indentRust(request),
    asyncMode ? "        let response = request.send().await?;" : "        let response = request.send()?;",
    "        let status = response.status();",
    asyncMode ? "        let body = response.text().await?;" : "        let body = response.text()?;",
    "        if !status.is_success() {",
    "            return Err(format!(\"HTTP {}\", status).into());",
    "        }",
    "        println!(\"{}\", body);",
    "    }",
  ];
}

function renderMain(input: GenerateInput, asyncMode: boolean): string {
  const transfers = transferRecords(input);
  const renderTransfers = transfers.length > 0 ? transfers : [undefined];
  const prefix = needsHelperModule(input) ? ["mod helper;", ""] : [];
  const lines = asyncMode
    ? [
        ...prefix,
        "#[tokio::main]",
        "async fn main() -> Result<(), Box<dyn std::error::Error>> {",
        ...renderTransfers.flatMap((transfer) => renderRequestBlock(input, transfer, true)),
      ]
    : [
        ...prefix,
        "fn main() -> Result<(), Box<dyn std::error::Error>> {",
        ...renderTransfers.flatMap((transfer) => renderRequestBlock(input, transfer, false)),
      ];
  lines.push("    Ok(())", "}", "");
  return lines.join("\n");
}

export function applyRustReqwestGenerator(input: GenerateInput, output: GenerateOutput): GenerateOutput {
  const files: GeneratedFile[] = [
    {
      path: "Cargo.toml",
      role: "manifest",
      content: renderCargoToml(input),
    },
    {
      path: "src/main.rs",
      role: "main",
      content: renderMain(input, false),
    },
    {
      path: "src/async_main.rs",
      role: "main",
      content: renderMain(input, true),
    },
  ];
  if (needsHelperModule(input)) {
    files.push({
      path: "src/helper.rs",
      role: "helper",
      content: renderHelperModule(),
    });
  }
  return {
    ...output,
    files,
  };
}
