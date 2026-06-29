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

function goString(value: string): string {
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

function inlineCookieHeader(effective: JsonRecord): string | undefined {
  return asArray(effective.cookies)
    .map((value) => asString(asRecord(value)?.value))
    .filter((value): value is string => typeof value === "string" && value.includes("="))
    .join("; ") || undefined;
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

function jsonBodyFromBody(bodyKind: string | undefined, bodyValue: string): string | undefined {
  return bodyKind === "json" ? bodyValue : undefined;
}

function secondsToDuration(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return `${Math.round(parsed * 1000)} * time.Millisecond`;
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

function renderImports(imports: Set<string>): string {
  return [...imports].sort().map((name) => `\t${goString(name)}`).join("\n");
}

function renderGoTransfer(input: GenerateInput, transfer: JsonRecord | undefined, imports: Set<string>): string[] {
  const ir = input.ir;
  const effective = asRecord(transfer?.effective) ?? {};
  const argv = argvStrings(ir);
  const body = asRecord(effective.body);
  const bodyKind = asString(body?.kind);
  const bodyValue = asString(body?.value) ?? "";
  const externalBody = bodyExternalRef(ir, body);
  const jsonBody = jsonBodyFromBody(bodyKind, bodyValue);
  const externalHeaders = externalHeaderRefs(ir, effective);
  const methodValue = asString(asRecord(effective.method)?.value) ?? "GET";
  const method = jsonBody && methodValue === "GET" ? "POST" : methodValue;
  const proxy = asString(asRecord(effective.proxy)?.url);
  const tls = asRecord(effective.tls);
  const httpVersion = asString(effective.httpVersion);
  const cookie = inlineCookieHeader(effective);
  const jarPath = cookieJarPath(argv);
  const auth = asString(asRecord(effective.auth)?.value);
  const timeout = secondsToDuration(flagValue(argv, "--max-time", "-m"));
  const setup: string[] = ["\tvar body io.Reader"];
  const cleanup: string[] = [];
  const requestSetup: string[] = [];
  const clientSetup: string[] = ["\tclient := &http.Client{}"];
  const transportSetup: string[] = [];

  if (externalBody && (bodyKind === "form" || bodyKind === "form-string")) {
    const [name, value] = splitFormValue(bodyValue);
    const refValue = asString(externalBody.value) ?? "";
    imports.add("bytes");
    imports.add("mime/multipart");
    setup.push("\tvar formBody bytes.Buffer");
    setup.push("\twriter := multipart.NewWriter(&formBody)");
    setup.push(`\tformBytes, err := os.ReadFile(${goString(refValue)})`);
    setup.push("\tif err != nil {");
    setup.push("\t\treturn err");
    setup.push("\t}");
    if (value.startsWith("<")) {
      setup.push(`\tif err := writer.WriteField(${goString(name)}, string(formBytes)); err != nil {`);
      setup.push("\t\treturn err");
      setup.push("\t}");
    } else {
      setup.push(`\tpart, err := writer.CreateFormFile(${goString(name)}, ${goString(externalFileName(externalBody))})`);
      setup.push("\tif err != nil {");
      setup.push("\t\treturn err");
      setup.push("\t}");
      setup.push("\tif _, err := part.Write(formBytes); err != nil {");
      setup.push("\t\treturn err");
      setup.push("\t}");
    }
    setup.push("\tif err := writer.Close(); err != nil {");
    setup.push("\t\treturn err");
    setup.push("\t}");
    setup.push("\tbody = &formBody");
    requestSetup.push("\treq.Header.Set(\"Content-Type\", writer.FormDataContentType())");
  } else if (externalBody) {
    if (externalBody.kind === "stdin") {
      setup.push("\tbody = os.Stdin");
    } else {
      const value = asString(externalBody.value);
      imports.add("bytes");
      setup.push(`\tbodyBytes, err := os.ReadFile(${goString(value ?? "")})`);
      setup.push("\tif err != nil {");
      setup.push("\t\treturn err");
      setup.push("\t}");
      setup.push("\tbody = bytes.NewReader(bodyBytes)");
    }
    if (bodyKind === "json") {
      requestSetup.push('\treq.Header.Set("Content-Type", "application/json")');
    }
  } else if (jsonBody) {
    imports.add("strings");
    setup.push(`\tbody = strings.NewReader(${goString(jsonBody)})`);
    requestSetup.push('\treq.Header.Set("Content-Type", "application/json")');
  } else if (bodyKind === "form" || bodyKind === "form-string") {
    const [name, value] = splitFormValue(bodyValue);
    imports.add("bytes");
    imports.add("mime/multipart");
    setup.push("\tvar formBody bytes.Buffer");
    setup.push("\twriter := multipart.NewWriter(&formBody)");
    setup.push(`\tif err := writer.WriteField(${goString(name)}, ${goString(value)}); err != nil {`);
    setup.push("\t\treturn err");
    setup.push("\t}");
    setup.push("\tif err := writer.Close(); err != nil {");
    setup.push("\t\treturn err");
    setup.push("\t}");
    setup.push("\tbody = &formBody");
    requestSetup.push("\treq.Header.Set(\"Content-Type\", writer.FormDataContentType())");
  } else if (bodyKind === "upload-file") {
    setup.push(`\tupload, err := os.Open(${goString(bodyValue)})`);
    setup.push("\tif err != nil {");
    setup.push("\t\treturn err");
    setup.push("\t}");
    cleanup.push("\tdefer upload.Close()");
    setup.push("\tbody = upload");
  } else if (bodyKind) {
    imports.add("strings");
    setup.push(`\tbody = strings.NewReader(${goString(bodyValue)})`);
  }

  setup.push(
    `\treq, err := http.NewRequestWithContext(ctx, ${goString(method)}, ${goString(asString(transfer?.url) ?? "")}, body)`,
    "\tif err != nil {",
    "\t\treturn err",
    "\t}",
  );
  for (const [name, value] of headerPairs(effective)) {
    requestSetup.push(`\treq.Header.Add(${goString(name)}, ${goString(value)})`);
  }
  for (const [index, ref] of externalHeaders.entries()) {
    imports.add("strings");
    if (ref.kind === "stdin") {
      requestSetup.push(`\theaderBytes${index}, err := io.ReadAll(os.Stdin)`);
    } else {
      requestSetup.push(`\theaderBytes${index}, err := os.ReadFile(${goString(asString(ref.value) ?? "")})`);
    }
    requestSetup.push("\tif err != nil {");
    requestSetup.push("\t\treturn err");
    requestSetup.push("\t}");
    requestSetup.push(`\tfor _, line := range strings.Split(string(headerBytes${index}), "\\n") {`);
    requestSetup.push("\t\tline = strings.TrimRight(line, \"\\r\")");
    requestSetup.push("\t\tif strings.TrimSpace(line) == \"\" || strings.HasPrefix(strings.TrimLeft(line, \" \\t\"), \"#\") {");
    requestSetup.push("\t\t\tcontinue");
    requestSetup.push("\t\t}");
    requestSetup.push("\t\tname, value, ok := strings.Cut(line, \":\")");
    requestSetup.push("\t\tif ok && strings.TrimSpace(name) != \"\" {");
    requestSetup.push("\t\t\treq.Header.Add(name, strings.TrimLeft(value, \" \\t\"))");
    requestSetup.push("\t\t}");
    requestSetup.push("\t}");
  }
  if (cookie) {
    requestSetup.push(`\treq.Header.Set("Cookie", ${goString(cookie)})`);
  }
  if (auth) {
    requestSetup.push('\treq.Header.Set("Authorization", "Basic REDACTED")');
  }
  if (proxy || tls?.verify === false || httpVersion === "2") {
    transportSetup.push("\ttransport := &http.Transport{}");
    if (proxy) {
      imports.add("net/url");
      transportSetup.push(`\tproxyURL, err := url.Parse(${goString(proxy)})`);
      transportSetup.push("\tif err != nil {");
      transportSetup.push("\t\treturn err");
      transportSetup.push("\t}");
      transportSetup.push("\ttransport.Proxy = http.ProxyURL(proxyURL)");
    }
    if (tls?.verify === false) {
      imports.add("crypto/tls");
      transportSetup.push("\ttransport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} // curl -k");
    }
    if (httpVersion === "2" || hasFlag(argv, "--http2", "--http2-prior-knowledge")) {
      transportSetup.push("\ttransport.ForceAttemptHTTP2 = true");
    }
    transportSetup.push("\tclient.Transport = transport");
  }
  if (hasFlag(argv, "-L", "--location", "--location-trusted")) {
    clientSetup.push("\tclient.CheckRedirect = nil");
  }
  if (timeout) {
    imports.add("time");
    clientSetup.push(`\tclient.Timeout = ${timeout}`);
  }
  if (jarPath) {
    clientSetup.push(`\tjar, err := loadCookieJar(${goString(jarPath)})`);
    clientSetup.push("\tif err != nil {");
    clientSetup.push("\t\treturn err");
    clientSetup.push("\t}");
    clientSetup.push("\tclient.Jar = jar");
  }

  return [
    "\t{",
    ...setup,
    ...cleanup,
    ...requestSetup,
    ...clientSetup,
    ...transportSetup,
    "\tresp, err := client.Do(req)",
    "\tif err != nil {",
    "\t\treturn err",
    "\t}",
    "\tdefer resp.Body.Close()",
    "\tif resp.StatusCode < 200 || resp.StatusCode >= 300 {",
    '\t\treturn fmt.Errorf("HTTP %d", resp.StatusCode)',
    "\t}",
    "\t_, err = io.Copy(os.Stdout, resp.Body)",
    "\tif err != nil {",
    "\t\treturn err",
    "\t}",
    "\t}",
    "",
  ].map((line) => (line ? `\t${line}` : line));
}

function renderGoMain(input: GenerateInput): string {
  const imports = new Set(["context", "fmt", "io", "net/http", "os"]);
  const transfers = transferRecords(input.ir);
  const renderTransfers = transfers.length > 0 ? transfers : [undefined];
  const blocks = renderTransfers.flatMap((transfer) => renderGoTransfer(input, transfer, imports));
  const lines = [
    "package main",
    "",
    "import (",
    renderImports(imports),
    ")",
    "",
    "func main() {",
    "\tif err := run(); err != nil {",
    "\t\tfmt.Fprintln(os.Stderr, err)",
    "\t\tos.Exit(1)",
    "\t}",
    "}",
    "",
    "func run() error {",
    "\tctx := context.Background()",
    ...blocks,
    "\treturn nil",
    "}",
    "",
  ];
  return lines.join("\n").replace(/\t/gu, "    ");
}

function renderGoHelper(): string {
  return [
    "package main",
    "",
    "import (",
    '\t"net/http/cookiejar"',
    ")",
    "",
    "func loadCookieJar(path string) (*cookiejar.Jar, error) {",
    "\t_ = path",
    "\treturn cookiejar.New(nil)",
    "}",
    "",
  ].join("\n").replace(/\t/gu, "    ");
}

function augmentGoOutput(input: GenerateInput, output: GenerateOutput): GenerateOutput {
  const argv = argvStrings(input.ir);
  let next = output;
  if (cookieJarPath(argv)) {
    next = withSupportItem(next, {
      behavior: "cookies.jar",
      level: "requires-runtime-helper",
      message: "Cookie jar files require helper loading for net/http cookie jars.",
    });
    next = withDiagnostic(next, {
      code: "W_TARGET_HELPER_REQUIRED",
      severity: "warning",
      category: "support",
      message: "Cookie jar replay requires generated helper.go.",
      details: {
        target: "go.net_http",
        behavior: "cookies.jar",
      },
    });
  }
  return next;
}

export function applyGoNetHttpGenerator(input: GenerateInput, output: GenerateOutput): GenerateOutput {
  const argv = argvStrings(input.ir);
  const files: GeneratedFile[] = [
    {
      path: "main.go",
      role: "main",
      content: renderGoMain(input),
    },
  ];
  if (cookieJarPath(argv)) {
    files.push({
      path: "helper.go",
      role: "helper",
      content: renderGoHelper(),
    });
  }
  return augmentGoOutput(input, {
    ...output,
    files,
  });
}
