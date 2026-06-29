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

function pythonExternalRead(ref: JsonRecord | undefined): string | undefined {
  if (!ref) {
    return undefined;
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

function pythonExternalText(ref: JsonRecord | undefined): string | undefined {
  if (!ref) {
    return undefined;
  }
  if (ref.kind === "stdin") {
    return "sys.stdin.read()";
  }
  const value = asString(ref.value);
  return value ? `Path(${pythonString(value)}).read_text()` : undefined;
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

function cookieJarPath(argv: string[]): string | undefined {
  const value = flagValue(argv, "-b", "--cookie", "--cookie-jar");
  return value && !value.includes("=") ? value : undefined;
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

function seconds(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
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

function withDiagnostic(output: GenerateOutput, diagnostic: Diagnostic): GenerateOutput {
  return {
    ...output,
    diagnostics: [...output.diagnostics, diagnostic],
  };
}

function variableName(base: string, index: number, multi: boolean): string {
  return multi ? `${base}_${index}` : base;
}

function renderPythonRequestBlock(input: GenerateInput, transfer: JsonRecord | undefined, index: number, multi: boolean): string[] {
  const ir = input.ir;
  const effective = asRecord(transfer?.effective) ?? {};
  const method = asString(asRecord(effective.method)?.value) ?? "GET";
  const body = asRecord(effective.body);
  const bodyKind = asString(body?.kind);
  const bodyValue = asString(body?.value) ?? "";
  const auth = asString(asRecord(effective.auth)?.value);
  const proxy = asString(asRecord(effective.proxy)?.url);
  const tls = asRecord(effective.tls);
  const argv = argvStrings(ir);
  const headers = headerEntries(effective);
  const externalHeaders = externalHeaderRefs(ir, effective);
  const cookieValue = inlineCookieValue(effective);
  const jarPath = cookieJarPath(argv);
  const connectTimeout = seconds(flagValue(argv, "--connect-timeout"));
  const maxTime = seconds(flagValue(argv, "--max-time", "-m"));
  const cert = flagValue(argv, "--cert", "-E");
  const caBundle = flagValue(argv, "--cacert");
  const jsonBody = jsonBodyFromBody(bodyKind, bodyValue);
  const externalBody = bodyExternalRef(ir, body);
  const externalBodyRead = pythonExternalRead(externalBody);
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
    const text = pythonExternalText(ref);
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
    lines.push(
      `    ${kwargsName}["auth"] = (${pythonString(username)}, ${pythonString(password)})`,
    );
  }
  if (cookieValue) {
    lines.push(`    ${kwargsName}["cookies"] = ${pythonDict(cookieEntries(cookieValue))}`);
  }
  if (jarPath) {
    lines.push(`    session.cookies.update(load_cookie_jar(${pythonString(jarPath)}))`);
  }
  if (proxy) {
    lines.push(
      `    ${kwargsName}["proxies"] = {"http": ${pythonString(proxy)}, "https": ${pythonString(proxy)}}`,
    );
  }
  if (tls?.verify === false || hasFlag(argv, "-k", "--insecure")) {
    lines.push(`    ${kwargsName}["verify"] = False`);
  } else if (caBundle) {
    lines.push(`    ${kwargsName}["verify"] = ${pythonString(caBundle)}`);
  }
  if (cert) {
    lines.push(`    ${kwargsName}["cert"] = ${pythonString(cert)}`);
  }
  if (connectTimeout !== undefined && maxTime !== undefined) {
    lines.push(`    ${kwargsName}["timeout"] = (${connectTimeout}, ${maxTime})`);
  } else if (maxTime !== undefined) {
    lines.push(`    ${kwargsName}["timeout"] = ${maxTime}`);
  } else if (connectTimeout !== undefined) {
    lines.push(`    ${kwargsName}["timeout"] = (${connectTimeout}, None)`);
  }

  const requestLine = `${responseName} = session.request(${pythonString(requestMethod)}, ${urlName}, **${kwargsName})`;
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
  const lines = [
    "from http.cookiejar import MozillaCookieJar",
    "from pathlib import Path",
    "import sys",
    "",
    "import requests",
    "",
    "",
    "def load_cookie_jar(path):",
    "    jar = MozillaCookieJar()",
    "    jar.load(path, ignore_discard=True, ignore_expires=True)",
    "    return jar",
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
    "def main():",
    "    session = requests.Session()",
  ];

  for (const [index, transfer] of renderTransfers.entries()) {
    lines.push(...renderPythonRequestBlock(input, transfer, index, multi));
  }

  lines.push(
    "if __name__ == \"__main__\":",
    "    main()",
    "",
  );
  return lines.join("\n");
}

function augmentPythonRequestsOutput(input: GenerateInput, output: GenerateOutput): GenerateOutput {
  const ir = input.ir;
  const argv = argvStrings(ir);
  let next = output;

  if (
    transferRecords(ir).some((transfer) => asString(asRecord(transfer.effective)?.httpVersion) === "2") ||
    hasFlag(argv, "--http2", "--http2-prior-knowledge")
  ) {
    next = withDiagnostic(next, {
      code: "W_TARGET_LOSSY",
      severity: "warning",
      category: "target",
      message: "requests cannot force HTTP/2; generated code uses transport defaults.",
      details: {
        target: "python.requests",
        behavior: "http.version.2",
      },
    });
  }

  for (const transfer of transferRecords(ir)) {
    const effective = asRecord(transfer.effective) ?? {};
    const headers = headerEntries(effective);
    const duplicates = duplicateHeaderNames(headers);
    if (duplicates.length > 0) {
      next = withSupportItem(next, {
        behavior: "headers",
        level: "lossy",
        message: "requests headers are generated as a mapping; duplicate header names collapse.",
      });
      next = withDiagnostic(next, {
        code: "W_TARGET_LOSSY",
        severity: "warning",
        category: "target",
        message: "Duplicate headers collapse when represented as a requests header mapping.",
        details: {
          target: "python.requests",
          behavior: "headers",
        },
      });
    }
  }

  if (cookieJarPath(argv)) {
    next = withSupportItem(next, {
      behavior: "cookies.jar",
      level: "requires-runtime-helper",
      message: "Cookie jar files require helper loading through MozillaCookieJar.",
    });
    next = withDiagnostic(next, {
      code: "W_TARGET_HELPER_REQUIRED",
      severity: "warning",
      category: "support",
      message: "Cookie jar replay requires the generated load_cookie_jar helper.",
      details: {
        target: "python.requests",
        behavior: "cookies.jar",
      },
    });
  }

  return next;
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
  return augmentPythonRequestsOutput(input, {
    ...output,
    files,
  });
}
