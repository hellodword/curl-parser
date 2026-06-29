import type {
  CurlIr,
  Diagnostic,
  SupportItem,
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

function argvStrings(ir: CurlIr): string[] {
  return asArray(ir.command.argv).filter((value): value is string => typeof value === "string");
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

function pushFetchExternalHeaderLines(lines: string[], headersName: string, refs: JsonRecord[]): void {
  for (const ref of refs) {
    const text = externalTextReadExpression(ref);
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

function duplicateHeaderNames(headers: Array<[string, string]>): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const [name] of headers) {
    const key = name.toLowerCase();
    if (seen.has(key)) {
      duplicates.add(name);
    }
    seen.add(key);
  }
  return [...duplicates];
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

function pushFormBodyLines(lines: string[], bodyValue: string, externalBody: JsonRecord | undefined): void {
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
    const text = externalTextExpression(externalBody) ?? js("");
    lines.push(`    form.append(${js(name)}, ${text});`);
  } else {
    const read = externalReadExpression(externalBody) ?? "new Uint8Array()";
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

function secondsToMillis(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 1000) : undefined;
}

function levelRank(level: string): number {
  return {
    exact: 0,
    lossy: 1,
    "requires-runtime-helper": 2,
    unsupported: 3,
  }[level] ?? 0;
}

function withSupportItem(output: GenerateOutput, item: SupportItem): GenerateOutput {
  const level =
    levelRank(item.level ?? "exact") > levelRank(output.support.level)
      ? (item.level ?? output.support.level)
      : output.support.level;
  return {
    ...output,
    support: {
      level,
      items: [...output.support.items, item],
    },
  };
}

function withDiagnostic(output: GenerateOutput, diagnostic: Diagnostic): GenerateOutput {
  return {
    ...output,
    diagnostics: [...output.diagnostics, diagnostic],
  };
}

function duplicateHeaderWarning(output: GenerateOutput, headers: Array<[string, string]>): GenerateOutput {
  if (duplicateHeaderNames(headers).length === 0) {
    return output;
  }
  return withDiagnostic(
    withSupportItem(output, {
      behavior: "headers",
      level: "lossy",
      message: "Duplicate header names may be coalesced by the JavaScript Headers implementation.",
    }),
    {
      code: "W_TARGET_LOSSY",
      severity: "warning",
      category: "target",
      message: "Duplicate header names may be coalesced by the JavaScript Headers implementation.",
      details: {
        behavior: "headers",
      },
    },
  );
}

function variableName(base: string, index: number, multi: boolean): string {
  return multi ? `${base}${index}` : base;
}

function renderFetchTransfer(input: GenerateInput, transfer: JsonRecord | undefined, index: number, multi: boolean): string {
  const ir = input.ir;
  const effective = asRecord(transfer?.effective) ?? {};
  const body = asRecord(effective.body);
  const bodyKind = asString(body?.kind);
  const bodyValue = asString(body?.value) ?? "";
  const methodValue = asString(asRecord(effective.method)?.value) ?? "GET";
  const argv = argvStrings(ir);
  const jsonBody = jsonBodyFromBody(bodyKind, bodyValue);
  const externalBody = bodyExternalRef(ir, body);
  const externalBodyRead = externalReadExpression(externalBody);
  const method = jsonBody !== undefined && methodValue === "GET" ? "POST" : methodValue;
  const headers = headerPairs(effective);
  const externalHeaders = externalHeaderRefs(ir, effective);
  const cookie = inlineCookieHeader(effective);
  const auth = asString(asRecord(effective.auth)?.value);
  const timeoutMs = secondsToMillis(flagValue(argv, "--max-time", "-m"));
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
  pushFetchExternalHeaderLines(lines, headersName, externalHeaders);
  lines.push("", `const ${initName} = {`, `  method: ${js(method)},`, `  headers: ${headersName},`);

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

  if (hasFlag(argv, "-L", "--location", "--location-trusted")) {
    lines.push('  redirect: "follow",');
  }

  lines.push("};");
  if (timeoutMs !== undefined) {
    lines.push("", "const controller = new AbortController();");
    lines[lines.length - 1] = `const ${controllerName} = new AbortController();`;
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
  return renderTransfers
    .map((transfer, index) => renderFetchTransfer(input, transfer, index, multi))
    .join("\n");
}

function renderUndiciTransfer(input: GenerateInput, transfer: JsonRecord | undefined, index: number, multi: boolean): string {
  const ir = input.ir;
  const effective = asRecord(transfer?.effective) ?? {};
  const body = asRecord(effective.body);
  const bodyKind = asString(body?.kind);
  const bodyValue = asString(body?.value) ?? "";
  const methodValue = asString(asRecord(effective.method)?.value) ?? "GET";
  const proxy = asString(asRecord(effective.proxy)?.url);
  const tls = asRecord(effective.tls);
  const argv = argvStrings(ir);
  const jsonBody = jsonBodyFromBody(bodyKind, bodyValue);
  const externalBody = bodyExternalRef(ir, body);
  const externalBodyRead = externalReadExpression(externalBody);
  const method = jsonBody !== undefined && methodValue === "GET" ? "POST" : methodValue;
  const headers = Object.fromEntries(headerPairs(effective));
  const externalHeaders = externalHeaderRefs(ir, effective);
  const cookie = inlineCookieHeader(effective);
  const auth = asString(asRecord(effective.auth)?.value);
  const timeoutMs = secondsToMillis(flagValue(argv, "--max-time", "-m"));
  const urlName = variableName("url", index, multi);
  const optionsName = variableName("options", index, multi);
  const statusName = variableName("statusCode", index, multi);
  const bodyName = variableName("body", index, multi);
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
  lines.push(
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
  if (proxy) {
    lines.push(`  dispatcher: new ProxyAgent(${js(proxy)}),`);
  } else if (tls?.verify === false) {
    lines.push("  dispatcher: new Agent({ connect: { rejectUnauthorized: false } }),");
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
  const needsProxy = renderTransfers.some((transfer) =>
    Boolean(asString(asRecord(asRecord(transfer?.effective)?.proxy)?.url)),
  );
  const needsAgent = renderTransfers.some((transfer) =>
    asRecord(asRecord(transfer?.effective)?.tls)?.verify === false,
  );
  const needsReadFile = renderTransfers.some((transfer) => {
    const effective = asRecord(transfer?.effective) ?? {};
    return Boolean(bodyExternalRef(input.ir, asRecord(effective.body))) ||
      externalHeaderRefs(input.ir, effective).length > 0;
  });
  const imports = [needsProxy
    ? 'import { ProxyAgent, request } from "undici";'
    : needsAgent
      ? 'import { Agent, request } from "undici";'
      : 'import { request } from "undici";'];
  if (needsReadFile) {
    imports.push('import { readFile } from "node:' + 'fs/promises";');
  }
  return [
    ...imports,
    "",
    ...renderTransfers.map((transfer, index) =>
      renderUndiciTransfer(input, transfer, index, multi),
    ),
  ].join("\n");
}

function applyJavaScriptWarnings(input: GenerateInput, output: GenerateOutput): GenerateOutput {
  let next = output;
  for (const transfer of transferRecords(input.ir)) {
    const effective = asRecord(transfer?.effective) ?? {};
    next = duplicateHeaderWarning(next, headerPairs(effective));
    if (input.target === "js.fetch" && inlineCookieHeader(effective)) {
      next = withDiagnostic(
        withSupportItem(next, {
          behavior: "cookies.inline",
          level: "lossy",
          message: "Browser fetch runtimes may reject explicit Cookie headers.",
        }),
        {
          code: "W_TARGET_RUNTIME_DIFFERENCE",
          severity: "warning",
          category: "target",
          message: "Browser fetch runtimes may reject explicit Cookie headers.",
          details: {
            behavior: "cookies.inline",
          },
        },
      );
    }
  }
  return next;
}

export function applyJavaScriptGenerator(input: GenerateInput, output: GenerateOutput): GenerateOutput {
  const files: GeneratedFile[] =
    input.target === "js.undici"
      ? [{ path: "main.mjs", role: "main", content: renderUndiciMain(input) }]
      : [{ path: "main.js", role: "main", content: renderFetchMain(input) }];
  return applyJavaScriptWarnings(input, {
    ...output,
    files,
  });
}
