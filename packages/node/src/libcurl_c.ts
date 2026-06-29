import type { CurlIr, GenerateInput, GenerateOutput, GeneratedFile } from "./types.js";

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

function cString(value: string): string {
  return JSON.stringify(value);
}

function cLong(value: number): string {
  return `${Math.max(0, Math.round(value))}L`;
}

function argvStrings(ir: CurlIr): string[] {
  return asArray(ir.command.argv).filter((value): value is string => typeof value === "string");
}

function hasFlag(argv: string[], ...flags: string[]): boolean {
  return argv.some((value) => flags.includes(value));
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

function secondsToMillis(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed * 1000;
}

function headerLines(effective: JsonRecord): string[] {
  return asArray(effective.headers)
    .map((value) => {
      const header = asRecord(value);
      const raw = asString(header?.raw);
      if (raw) {
        return raw;
      }
      const name = asString(header?.name);
      const fieldValue = asString(header?.value);
      return name && fieldValue !== undefined ? `${name}: ${fieldValue}` : undefined;
    })
    .filter((value): value is string => typeof value === "string");
}

function externalHeaderRefs(ir: CurlIr, effective: JsonRecord): JsonRecord[] {
  return asArray(effective.headers)
    .map((value) => externalRefById(ir, asString(asRecord(value)?.externalRefId)))
    .filter((value): value is JsonRecord => Boolean(value));
}

function cookieLine(effective: JsonRecord): string | undefined {
  const values = asArray(effective.cookies)
    .map((value) => asString(asRecord(value)?.value))
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  return values.length > 0 ? values.join("; ") : undefined;
}

function splitFormValue(value: string): { name: string; value: string } {
  const equal = value.indexOf("=");
  if (equal < 0) {
    return { name: value || "field", value: "" };
  }
  return {
    name: value.slice(0, equal) || "field",
    value: value.slice(equal + 1),
  };
}

function pushHeaderSetup(lines: string[], headers: string[], externalHeaders: JsonRecord[]): void {
  for (const header of headers) {
    lines.push(`  next_header = curl_slist_append(headers, ${cString(header)});`);
    lines.push("  if(!next_header) {");
    lines.push('    fprintf(stderr, "curl_slist_append failed\\n");');
    lines.push("    goto cleanup;");
    lines.push("  }");
    lines.push("  headers = next_header;");
  }
  for (const ref of externalHeaders) {
    if (ref.kind === "stdin") {
      lines.push("  header_data = read_stream_to_memory(stdin, &header_data_size);");
    } else {
      lines.push(`  header_data = read_file_to_memory(${cString(asString(ref.value) ?? "")}, &header_data_size);`);
    }
    lines.push("  if(!header_data) {");
    lines.push('    fprintf(stderr, "failed to read header file\\n");');
    lines.push("    goto cleanup;");
    lines.push("  }");
    lines.push("  if(append_header_lines(&headers, header_data, header_data_size) != 0) {");
    lines.push('    fprintf(stderr, "failed to append header lines\\n");');
    lines.push("    goto cleanup;");
    lines.push("  }");
    lines.push("  free(header_data);");
    lines.push("  header_data = NULL;");
    lines.push("  header_data_size = 0U;");
  }
  if (headers.length > 0 || externalHeaders.length > 0) {
    lines.push("  CHECK_CURL(curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers));");
  }
}

function pushBodySetup(lines: string[], method: string, body: JsonRecord | undefined, ir: CurlIr): void {
  const kind = asString(body?.kind);
  const value = asString(body?.value) ?? "";
  const externalBody = bodyExternalRef(ir, body);

  if (kind === "form" || kind === "form-string") {
    const part = splitFormValue(value);
    lines.push("  mime = curl_mime_init(curl);");
    lines.push("  if(!mime) {");
    lines.push('    fprintf(stderr, "curl_mime_init failed\\n");');
    lines.push("    goto cleanup;");
    lines.push("  }");
    lines.push("  part = curl_mime_addpart(mime);");
    lines.push("  if(!part) {");
    lines.push('    fprintf(stderr, "curl_mime_addpart failed\\n");');
    lines.push("    goto cleanup;");
    lines.push("  }");
    lines.push(`  CHECK_CURL(curl_mime_name(part, ${cString(part.name)}));`);
    if (part.value.startsWith("<")) {
      lines.push(`  post_data = read_file_to_memory(${cString(part.value.slice(1))}, &post_data_size);`);
      lines.push("  if(!post_data) {");
      lines.push('    fprintf(stderr, "failed to read form field file\\n");');
      lines.push("    goto cleanup;");
      lines.push("  }");
      lines.push("  CHECK_CURL(curl_mime_data(part, post_data, post_data_size));");
    } else if (part.value.startsWith("@")) {
      lines.push(`  CHECK_CURL(curl_mime_filedata(part, ${cString(part.value.slice(1))}));`);
    } else {
      lines.push(`  CHECK_CURL(curl_mime_data(part, ${cString(part.value)}, CURL_ZERO_TERMINATED));`);
    }
    lines.push("  CHECK_CURL(curl_easy_setopt(curl, CURLOPT_MIMEPOST, mime));");
    return;
  }

  if (kind === "upload-file") {
    lines.push(`  upload = fopen(${cString(value)}, "rb");`);
    lines.push("  if(!upload) {");
    lines.push('    perror("fopen");');
    lines.push("    goto cleanup;");
    lines.push("  }");
    lines.push("  CHECK_CURL(curl_easy_setopt(curl, CURLOPT_UPLOAD, 1L));");
    lines.push("  CHECK_CURL(curl_easy_setopt(curl, CURLOPT_READDATA, upload));");
    return;
  }

  if (externalBody) {
    if (externalBody.kind === "stdin") {
      lines.push("  post_data = read_stream_to_memory(stdin, &post_data_size);");
    } else {
      lines.push(`  post_data = read_file_to_memory(${cString(asString(externalBody.value) ?? "")}, &post_data_size);`);
    }
    lines.push("  if(!post_data) {");
    lines.push('    fprintf(stderr, "failed to read request body\\n");');
    lines.push("    goto cleanup;");
    lines.push("  }");
    lines.push("  CHECK_CURL(curl_easy_setopt(curl, CURLOPT_POSTFIELDS, post_data));");
    lines.push("  CHECK_CURL(curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE_LARGE, (curl_off_t)post_data_size));");
    return;
  }

  if (kind) {
    lines.push(`  CHECK_CURL(curl_easy_setopt(curl, CURLOPT_POSTFIELDS, ${cString(value)}));`);
    lines.push(
      `  CHECK_CURL(curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, (long)strlen(${cString(value)})));`,
    );
    return;
  }

  if (method === "POST") {
    lines.push("  CHECK_CURL(curl_easy_setopt(curl, CURLOPT_POST, 1L));");
  }
}

function pushMethodSetup(lines: string[], method: string, body: JsonRecord | undefined): void {
  if (method === "GET" || (method === "POST" && body)) {
    return;
  }
  if (method === "POST") {
    lines.push("  CHECK_CURL(curl_easy_setopt(curl, CURLOPT_POST, 1L));");
    return;
  }
  lines.push(`  CHECK_CURL(curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, ${cString(method)}));`);
}

function renderLibcurlRequestFunction(ir: CurlIr, transfer: JsonRecord | undefined, index: number): string {
  const effective = asRecord(transfer?.effective) ?? {};
  const method = asString(asRecord(effective.method)?.value) ?? "GET";
  const body = asRecord(effective.body);
  const bodyKind = asString(body?.kind);
  const auth = asString(asRecord(effective.auth)?.value);
  const proxy = asString(asRecord(effective.proxy)?.url);
  const tls = asRecord(effective.tls);
  const cookie = cookieLine(effective);
  const httpVersion = asString(effective.httpVersion);
  const argv = argvStrings(ir);
  const timeoutMs = secondsToMillis(flagValue(argv, "--max-time", "-m"));
  const connectTimeoutMs = secondsToMillis(flagValue(argv, "--connect-timeout"));
  const headers = headerLines(effective);
  if (bodyKind === "json" && !headers.some((header) => header.toLowerCase().startsWith("content-type:"))) {
    headers.push("Content-Type: application/json");
  }
  const externalHeaders = externalHeaderRefs(ir, effective);
  const lines: string[] = [
    `static int perform_request_${index}(void)`,
    "{",
    "  CURLcode rc = CURLE_OK;",
    "  int exit_code = 1;",
    "  CURL *curl = NULL;",
    "  struct curl_slist *headers = NULL;",
    "  struct curl_slist *next_header = NULL;",
    "  curl_mime *mime = NULL;",
    "  curl_mimepart *part = NULL;",
    "  FILE *upload = NULL;",
    "  char *post_data = NULL;",
    "  size_t post_data_size = 0U;",
    "  char *header_data = NULL;",
    "  size_t header_data_size = 0U;",
    "",
    "  curl = curl_easy_init();",
    "  if(!curl) {",
    '    fprintf(stderr, "curl_easy_init failed\\n");',
    "    goto cleanup;",
    "  }",
    "",
    `  CHECK_CURL(curl_easy_setopt(curl, CURLOPT_URL, ${cString(asString(transfer?.url) ?? "")}));`,
  ];

  pushHeaderSetup(lines, headers, externalHeaders);
  pushBodySetup(lines, method, body, ir);
  pushMethodSetup(lines, method, body);

  if (auth) {
    lines.push(`  CHECK_CURL(curl_easy_setopt(curl, CURLOPT_USERPWD, ${cString(auth)}));`);
  }
  if (cookie) {
    lines.push(`  CHECK_CURL(curl_easy_setopt(curl, CURLOPT_COOKIE, ${cString(cookie)}));`);
  }
  if (proxy) {
    lines.push(`  CHECK_CURL(curl_easy_setopt(curl, CURLOPT_PROXY, ${cString(proxy)}));`);
  }
  if (tls?.verify === false) {
    lines.push("  CHECK_CURL(curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 0L));");
    lines.push("  CHECK_CURL(curl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 0L));");
  }
  if (hasFlag(argv, "-L", "--location", "--location-trusted")) {
    lines.push("  CHECK_CURL(curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L));");
  }
  if (timeoutMs !== undefined) {
    lines.push(`  CHECK_CURL(curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, ${cLong(timeoutMs)}));`);
  }
  if (connectTimeoutMs !== undefined) {
    lines.push(
      `  CHECK_CURL(curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT_MS, ${cLong(connectTimeoutMs)}));`,
    );
  }
  if (httpVersion === "2") {
    lines.push("  CHECK_CURL(curl_easy_setopt(curl, CURLOPT_HTTP_VERSION, CURL_HTTP_VERSION_2TLS));");
  }
  if (httpVersion === "3") {
    lines.push("  CHECK_CURL(curl_easy_setopt(curl, CURLOPT_HTTP_VERSION, CURL_HTTP_VERSION_3));");
  }

  lines.push(
    "",
    "  rc = curl_easy_perform(curl);",
    "  if(rc != CURLE_OK) {",
    '    fprintf(stderr, "curl_easy_perform failed: %s\\n", curl_easy_strerror(rc));',
    "    goto cleanup;",
    "  }",
    "  exit_code = 0;",
    "",
    "cleanup:",
    "  if(mime) {",
    "    curl_mime_free(mime);",
    "  }",
    "  if(headers) {",
    "    curl_slist_free_all(headers);",
    "  }",
    "  if(upload) {",
    "    fclose(upload);",
    "  }",
    "  if(post_data) {",
    "    free(post_data);",
    "  }",
    "  if(header_data) {",
    "    free(header_data);",
    "  }",
    "  if(curl) {",
    "    curl_easy_cleanup(curl);",
    "  }",
    "  return exit_code;",
    "}",
    "",
  );

  return lines.join("\n");
}

function renderLibcurlMain(ir: CurlIr): string {
  const transfers = transferRecords(ir);
  const renderTransfers = transfers.length > 0 ? transfers : [undefined];
  const lines: string[] = [
    "#include <curl/curl.h>",
    "#include <stdio.h>",
    "#include <stdlib.h>",
    "#include <string.h>",
    "",
    "#define CHECK_CURL(expr) do { \\",
    "  rc = (expr); \\",
    "  if(rc != CURLE_OK) { \\",
    '    fprintf(stderr, "%s failed: %s\\n", #expr, curl_easy_strerror(rc)); \\',
    "    goto cleanup; \\",
    "  } \\",
    "} while(0)",
    "",
    "static char *read_stream_to_memory(FILE *stream, size_t *out_size)",
    "{",
    "  size_t capacity = 4096U;",
    "  size_t size = 0U;",
    "  char *buffer = malloc(capacity);",
    "  int ch;",
    "  if(!buffer) {",
    "    return NULL;",
    "  }",
    "  while((ch = fgetc(stream)) != EOF) {",
    "    if(size == capacity) {",
    "      size_t next_capacity = capacity * 2U;",
    "      char *grown = realloc(buffer, next_capacity);",
    "      if(!grown) {",
    "        free(buffer);",
    "        return NULL;",
    "      }",
    "      buffer = grown;",
    "      capacity = next_capacity;",
    "    }",
    "    buffer[size++] = (char)ch;",
    "  }",
    "  *out_size = size;",
    "  return buffer;",
    "}",
    "",
    "static char *read_file_to_memory(const char *path, size_t *out_size)",
    "{",
    "  FILE *file = fopen(path, \"rb\");",
    "  char *buffer;",
    "  if(!file) {",
    "    perror(\"fopen\");",
    "    return NULL;",
    "  }",
    "  buffer = read_stream_to_memory(file, out_size);",
    "  fclose(file);",
    "  return buffer;",
    "}",
    "",
    "static int append_header_lines(struct curl_slist **headers, const char *data, size_t size)",
    "{",
    "  size_t start = 0U;",
    "  while(start < size) {",
    "    size_t end = start;",
    "    size_t length;",
    "    char *line;",
    "    struct curl_slist *next;",
    "    while(end < size && data[end] != '\\n') {",
    "      ++end;",
    "    }",
    "    length = end - start;",
    "    while(length > 0U && data[start + length - 1U] == '\\r') {",
    "      --length;",
    "    }",
    "    while(length > 0U && (data[start] == ' ' || data[start] == '\\t')) {",
    "      ++start;",
    "      --length;",
    "    }",
    "    if(length > 0U && data[start] != '#') {",
    "      line = malloc(length + 1U);",
    "      if(!line) {",
    "        return -1;",
    "      }",
    "      memcpy(line, data + start, length);",
    "      line[length] = '\\0';",
    "      next = curl_slist_append(*headers, line);",
    "      free(line);",
    "      if(!next) {",
    "        return -1;",
    "      }",
    "      *headers = next;",
    "    }",
    "    start = end + 1U;",
    "  }",
    "  return 0;",
    "}",
    "",
  ];

  for (const [index, transfer] of renderTransfers.entries()) {
    lines.push(renderLibcurlRequestFunction(ir, transfer, index));
  }

  lines.push(
    "int main(void)",
    "{",
    "  CURLcode rc = curl_global_init(CURL_GLOBAL_DEFAULT);",
    "  int exit_code = 1;",
    "",
    "  if(rc != CURLE_OK) {",
    '    fprintf(stderr, "curl_global_init failed: %s\\n", curl_easy_strerror(rc));',
    "    return 1;",
    "  }",
    "",
  );

  for (const index of renderTransfers.keys()) {
    lines.push(`  if(perform_request_${index}() != 0) {`, "    goto cleanup;", "  }");
  }

  lines.push(
    "  exit_code = 0;",
    "",
    "cleanup:",
    "  curl_global_cleanup();",
    "  return exit_code;",
    "}",
    "",
  );
  return lines.join("\n");
}

export function renderLibcurlFiles(input: GenerateInput): GeneratedFile[] {
  return [
    {
      path: "main.c",
      role: "main",
      content: renderLibcurlMain(input.ir),
    },
  ];
}

export function applyCodeGenerators(input: GenerateInput, output: GenerateOutput): GenerateOutput {
  if (input.target !== "c.libcurl") {
    return output;
  }
  return {
    ...output,
    files: renderLibcurlFiles(input),
  };
}
