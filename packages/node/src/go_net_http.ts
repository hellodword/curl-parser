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

function externalRefById(ir: CurlIr, id: string | undefined): JsonRecord | undefined {
  if (!id) {
    return undefined;
  }
  return ir.externalRefs
    .map((value) => asRecord(value))
    .find((value) => value?.id === id);
}

function refValue(ir: CurlIr, id: unknown): string | undefined {
  return asString(externalRefById(ir, asString(id))?.value);
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

function cookieJarPath(ir: CurlIr): string | undefined {
  for (const transfer of transferRecords(ir)) {
    const effective = asRecord(transfer.effective) ?? {};
    for (const cookie of asArray(effective.cookies)) {
      const ref = externalRefById(ir, asString(asRecord(cookie)?.externalRefId));
      const value = asString(ref?.value);
      if (value && !value.includes("=")) {
        return value;
      }
    }
  }
  const jar = ir.externalRefs
    .map((value) => asRecord(value))
    .find((ref) => ref?.kind === "cookie-jar" && typeof ref.value === "string");
  return asString(jar?.value);
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

function millisecondsToDuration(value: number | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const rounded = Math.round(value);
  if (rounded < 0) {
    return undefined;
  }
  return `${rounded} * time.Millisecond`;
}

function maxTimeout(effective: JsonRecord): string | undefined {
  return millisecondsToDuration(asNumber(asRecord(effective.timeouts)?.maxTimeMs));
}

function connectTimeout(effective: JsonRecord): string | undefined {
  return millisecondsToDuration(asNumber(asRecord(effective.timeouts)?.connectTimeoutMs));
}

function redirectLimit(effective: JsonRecord): number {
  const redirects = asRecord(effective.redirects);
  if (redirects?.follow === true) {
    return typeof redirects.max === "number" ? redirects.max : 50;
  }
  return 0;
}

function tlsCaPath(ir: CurlIr, tls: JsonRecord | undefined): string | undefined {
  return refValue(ir, tls?.caFileRefId);
}

function tlsClientCertPath(ir: CurlIr, tls: JsonRecord | undefined): string | undefined {
  return refValue(ir, tls?.clientCertRefId) ?? asString(tls?.clientCert);
}

function tlsClientKeyPath(ir: CurlIr, tls: JsonRecord | undefined): string | undefined {
  return refValue(ir, tls?.clientKeyRefId);
}

function needsTlsConfig(ir: CurlIr, tls: JsonRecord | undefined): boolean {
  return Boolean(tls) &&
    (tls?.verify === false ||
      Boolean(tlsCaPath(ir, tls)) ||
      Boolean(tlsClientCertPath(ir, tls)));
}

function needsDialHelper(effective: JsonRecord): boolean {
  return hasObjectFields(effective.network) || hasObjectFields(effective.dns);
}

function curlDialConfig(effective: JsonRecord): string {
  return JSON.stringify({
    dns: effective.dns ?? {},
    network: effective.network ?? {},
  });
}

function renderImports(imports: Set<string>): string {
  return [...imports].sort().map((name) => `\t${goString(name)}`).join("\n");
}

function renderGoTransfer(input: GenerateInput, transfer: JsonRecord | undefined, imports: Set<string>): string[] {
  const ir = input.ir;
  const effective = asRecord(transfer?.effective) ?? {};
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
  const httpVersion = httpVersionValue(effective.httpVersion);
  const cookie = inlineCookieHeader(effective);
  const jarPath = cookieJarPath(ir);
  const auth = asString(asRecord(effective.auth)?.value);
  const timeout = maxTimeout(effective);
  const dialTimeout = connectTimeout(effective);
  const redirects = redirectLimit(effective);
  const caPath = tlsCaPath(ir, tls);
  const certPath = tlsClientCertPath(ir, tls);
  const keyPath = tlsClientKeyPath(ir, tls);
  const hasTlsConfig = needsTlsConfig(ir, tls);
  const hasDialHelper = needsDialHelper(effective);
  const hasDebug = hasObjectFields(effective.debug);
  const hasCustomTransport = Boolean(proxy) ||
    hasTlsConfig ||
    httpVersion === "2" ||
    Boolean(dialTimeout) ||
    hasDialHelper;
  const setup: string[] = ["\tvar body io.Reader"];
  const cleanup: string[] = [];
  const requestSetup: string[] = [];
  const clientSetup: string[] = ["\tclient := &http.Client{}"];
  const transportSetup: string[] = [];
  const responseSetup: string[] = [];

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

  if (hasTlsConfig) {
    imports.add("crypto/tls");
    setup.push("\ttlsConfig := &tls.Config{}");
    if (tls?.verify === false) {
      setup.push("\ttlsConfig.InsecureSkipVerify = true // curl -k");
    }
    if (caPath) {
      setup.push(`\trootCAs, err := loadCAPool(${goString(caPath)})`);
      setup.push("\tif err != nil {");
      setup.push("\t\treturn err");
      setup.push("\t}");
      setup.push("\ttlsConfig.RootCAs = rootCAs");
    }
    if (certPath) {
      setup.push(`\tclientCert, err := loadClientCertificate(${goString(certPath)}, ${goString(keyPath ?? "")})`);
      setup.push("\tif err != nil {");
      setup.push("\t\treturn err");
      setup.push("\t}");
      setup.push("\ttlsConfig.Certificates = []tls.Certificate{clientCert}");
    }
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
  if (hasCustomTransport) {
    transportSetup.push("\ttransport := &http.Transport{}");
    if (proxy) {
      imports.add("net/url");
      transportSetup.push(`\tproxyURL, err := url.Parse(${goString(proxy)})`);
      transportSetup.push("\tif err != nil {");
      transportSetup.push("\t\treturn err");
      transportSetup.push("\t}");
      transportSetup.push("\ttransport.Proxy = http.ProxyURL(proxyURL)");
    }
    if (hasTlsConfig) {
      transportSetup.push("\ttransport.TLSClientConfig = tlsConfig");
    }
    if (httpVersion === "2" || httpVersion === undefined) {
      transportSetup.push("\ttransport.ForceAttemptHTTP2 = true");
    }
    if (dialTimeout && !hasDialHelper) {
      imports.add("net");
      imports.add("time");
      transportSetup.push(`\tdialer := &net.Dialer{Timeout: ${dialTimeout}}`);
      transportSetup.push("\ttransport.DialContext = dialer.DialContext");
    }
    if (hasDialHelper) {
      transportSetup.push(`\ttransport.DialContext = createCurlDialContext(${goString(curlDialConfig(effective))})`);
    }
    transportSetup.push("\tclient.Transport = transport");
  }
  if (redirects === 0) {
    clientSetup.push("\tclient.CheckRedirect = func(req *http.Request, via []*http.Request) error {");
    clientSetup.push("\t\treturn http.ErrUseLastResponse");
    clientSetup.push("\t}");
  } else {
    clientSetup.push("\tclient.CheckRedirect = func(req *http.Request, via []*http.Request) error {");
    clientSetup.push(`\t\tif len(via) >= ${redirects} {`);
    clientSetup.push("\t\t\treturn http.ErrUseLastResponse");
    clientSetup.push("\t\t}");
    clientSetup.push("\t\treturn nil");
    clientSetup.push("\t}");
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
  if (hasDebug) {
    imports.add("net/http/httputil");
    transportSetup.push("\tif dump, err := httputil.DumpRequestOut(req, false); err == nil {");
    transportSetup.push("\t\t_, _ = os.Stderr.Write(dump)");
    transportSetup.push("\t}");
    responseSetup.push("\tif dump, err := httputil.DumpResponse(resp, false); err == nil {");
    responseSetup.push("\t\t_, _ = os.Stderr.Write(dump)");
    responseSetup.push("\t}");
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
    ...responseSetup,
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

function needsCookieJarHelper(input: GenerateInput): boolean {
  return Boolean(cookieJarPath(input.ir));
}

function needsTlsHelper(input: GenerateInput): boolean {
  return transferRecords(input.ir).some((transfer) => {
    const tls = asRecord(asRecord(transfer.effective)?.tls);
    return Boolean(tlsCaPath(input.ir, tls)) || Boolean(tlsClientCertPath(input.ir, tls));
  });
}

function needsDialContextHelper(input: GenerateInput): boolean {
  return transferRecords(input.ir).some((transfer) =>
    needsDialHelper(asRecord(transfer.effective) ?? {}),
  );
}

function renderGoHelper(input: GenerateInput): string {
  const imports = new Set<string>();
  const blocks: string[] = [];

  if (needsCookieJarHelper(input)) {
    imports.add("net/http/cookiejar");
    blocks.push(
      "func loadCookieJar(path string) (*cookiejar.Jar, error) {",
      "\t_ = path",
      "\treturn cookiejar.New(nil)",
      "}",
      "",
    );
  }

  if (needsTlsHelper(input)) {
    imports.add("crypto/tls");
    imports.add("crypto/x509");
    imports.add("fmt");
    imports.add("os");
    blocks.push(
      "func loadCAPool(path string) (*x509.CertPool, error) {",
      "\trootCAs, err := x509.SystemCertPool()",
      "\tif err != nil {",
      "\t\trootCAs = x509.NewCertPool()",
      "\t}",
      "\tpemBytes, err := os.ReadFile(path)",
      "\tif err != nil {",
      "\t\treturn nil, err",
      "\t}",
      "\tif ok := rootCAs.AppendCertsFromPEM(pemBytes); !ok {",
      "\t\treturn nil, fmt.Errorf(\"failed to append CA certificates from %s\", path)",
      "\t}",
      "\treturn rootCAs, nil",
      "}",
      "",
      "func loadClientCertificate(certPath string, keyPath string) (tls.Certificate, error) {",
      "\tif keyPath == \"\" {",
      "\t\tkeyPath = certPath",
      "\t}",
      "\treturn tls.LoadX509KeyPair(certPath, keyPath)",
      "}",
      "",
    );
  }

  if (needsDialContextHelper(input)) {
    imports.add("context");
    imports.add("fmt");
    imports.add("net");
    blocks.push(
      "func createCurlDialContext(curlDialConfig string) func(context.Context, string, string) (net.Conn, error) {",
      "\treturn func(ctx context.Context, network string, address string) (net.Conn, error) {",
      "\t\t_ = ctx",
      "\t\t_ = network",
      "\t\t_ = address",
      "\t\treturn nil, fmt.Errorf(\"TODO: provide DialContext for curl DNS/network controls: %s\", curlDialConfig)",
      "\t}",
      "}",
      "",
    );
  }

  return [
    "package main",
    "",
    "import (",
    renderImports(imports),
    ")",
    "",
    ...blocks,
  ].join("\n").replace(/\t/gu, "    ");
}

export function applyGoNetHttpGenerator(input: GenerateInput, output: GenerateOutput): GenerateOutput {
  const files: GeneratedFile[] = [
    {
      path: "main.go",
      role: "main",
      content: renderGoMain(input),
    },
  ];
  if (needsCookieJarHelper(input) || needsTlsHelper(input) || needsDialContextHelper(input)) {
    files.push({
      path: "helper.go",
      role: "helper",
      content: renderGoHelper(input),
    });
  }
  return {
    ...output,
    files,
  };
}
