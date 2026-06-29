import type { SupportItem, GenerateInput, GenerateOutput, GeneratedFile } from "./types.js";

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

function externalRefById(input: GenerateInput, id: string | undefined): JsonRecord | undefined {
  if (!id) {
    return undefined;
  }
  return input.ir.externalRefs
    .map((value) => asRecord(value))
    .find((value) => value?.id === id);
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

function argvStrings(input: GenerateInput): string[] {
  return asArray(input.ir.command.argv).filter((value): value is string => typeof value === "string");
}

function flagValue(argv: string[], ...flags: string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    for (const flag of flags) {
      if (value === flag) {
        return argv[index + 1];
      }
      if (value.startsWith(`${flag}=`)) {
        return value.slice(flag.length + 1);
      }
    }
  }
  return undefined;
}

function hasFlag(argv: string[], ...flags: string[]): boolean {
  return argv.some((value) => flags.includes(value));
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

function timeoutMillis(argv: string[]): number | undefined {
  const value = flagValue(argv, "--max-time", "-m");
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 1000) : undefined;
}

function renderCargoToml(): string {
  return [
    "[package]",
    'name = "generated-curl-request"',
    'version = "0.1.0"',
    'edition = "2021"',
    "",
    "[dependencies]",
    'reqwest = { version = "0.12", features = ["blocking", "cookies", "json", "multipart", "rustls-tls"] }',
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

function renderRequestSetup(
  input: GenerateInput,
  transfer: JsonRecord | undefined,
  asyncMode: boolean,
): string[] {
  const effective = asRecord(transfer?.effective) ?? {};
  const argv = argvStrings(input);
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

function renderClientBuilder(input: GenerateInput, transfer: JsonRecord | undefined): string[] {
  const effective = asRecord(transfer?.effective) ?? {};
  const argv = argvStrings(input);
  const proxy = asString(asRecord(effective.proxy)?.url);
  const tls = asRecord(effective.tls);
  const timeout = timeoutMillis(argv);
  const lines = ["    let mut builder = reqwest::Client::builder();"];
  if (proxy) {
    lines.push(`    builder = builder.proxy(reqwest::Proxy::all(${rustString(proxy)})?);`);
  }
  if (tls?.verify === false || hasFlag(argv, "-k", "--insecure")) {
    lines.push("    builder = builder.danger_accept_invalid_certs(true);");
  }
  if (hasFlag(argv, "-L", "--location", "--location-trusted")) {
    lines.push("    builder = builder.redirect(reqwest::redirect::Policy::limited(10));");
  }
  if (timeout !== undefined) {
    lines.push(`    builder = builder.timeout(std::time::Duration::from_millis(${timeout}));`);
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
  const builder = asyncMode
    ? renderClientBuilder(input, transfer)
    : renderClientBuilder(input, transfer).map((line) =>
        line.replace("reqwest::Client::builder()", "reqwest::blocking::Client::builder()"),
      );
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
  const lines = asyncMode
    ? [
        "#[tokio::main]",
        "async fn main() -> Result<(), Box<dyn std::error::Error>> {",
        ...renderTransfers.flatMap((transfer) => renderRequestBlock(input, transfer, true)),
      ]
    : [
        "fn main() -> Result<(), Box<dyn std::error::Error>> {",
        ...renderTransfers.flatMap((transfer) => renderRequestBlock(input, transfer, false)),
      ];
  lines.push("    Ok(())", "}", "");
  return lines.join("\n");
}

const levelRank: Record<string, number> = {
  exact: 0,
  lossy: 1,
  "requires-runtime-helper": 2,
  unsupported: 3,
};

function aggregateLevel(current: string, next: string): string {
  return (levelRank[next] ?? 0) > (levelRank[current] ?? 0) ? next : current;
}

function withSupportItem(output: GenerateOutput, item: SupportItem): GenerateOutput {
  return {
    ...output,
    support: {
      level: aggregateLevel(output.support.level, item.level ?? "exact"),
      items: [...output.support.items, item],
    },
  };
}

function augmentRustOutput(input: GenerateInput, output: GenerateOutput): GenerateOutput {
  if (transferRecords(input).some((transfer) => asString(asRecord(transfer.effective)?.httpVersion) === "3")) {
    return withSupportItem(output, {
      behavior: "http.version.3",
      level: "unsupported",
      message: "reqwest HTTP/3 support is not treated as a stable generated target capability.",
    });
  }
  return output;
}

export function applyRustReqwestGenerator(input: GenerateInput, output: GenerateOutput): GenerateOutput {
  const files: GeneratedFile[] = [
    {
      path: "Cargo.toml",
      role: "manifest",
      content: renderCargoToml(),
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
  return augmentRustOutput(input, {
    ...output,
    files,
  });
}
