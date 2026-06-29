import type {
  CommandExplanation,
  ExternalRef,
  ParseOutput,
  ShellParseResult,
} from "./types";

interface ParseEvent {
  argvIndex?: number;
  rawFlag?: string;
  canonical?: string | null;
  value?: unknown;
  valueArgvIndex?: number | null;
  usedNextArg?: boolean;
  isPositional?: boolean;
}

interface OptionDescription {
  title: string;
  description: string;
  valueTitle?: string;
  valueDescription?: string;
  sensitiveValue?: boolean;
}

const optionDescriptions: Record<string, OptionDescription> = {
  header: {
    title: "HTTP header",
    description: "Adds a request header.",
    valueTitle: "Header value",
    valueDescription: "Header name and value sent with the request.",
  },
  json: {
    title: "JSON body",
    description: "Adds a JSON request body and implies POST when no method is set.",
    valueTitle: "JSON payload",
    valueDescription: "Request body serialized as JSON.",
  },
  data: {
    title: "Request body",
    description: "Adds request body data and implies POST when no method is set.",
    valueTitle: "Body value",
    valueDescription: "Request body content or a file reference.",
  },
  "data-raw": {
    title: "Raw request body",
    description: "Adds request body data without curl's special @ file handling.",
    valueTitle: "Body value",
    valueDescription: "Raw request body content.",
  },
  "data-binary": {
    title: "Binary request body",
    description: "Adds request body data with binary-preserving curl semantics.",
    valueTitle: "Body value",
    valueDescription: "Binary request body content or a file reference.",
  },
  form: {
    title: "Multipart form field",
    description: "Adds a multipart form field or file part.",
    valueTitle: "Form field",
    valueDescription: "Multipart field definition.",
  },
  "form-string": {
    title: "Multipart text field",
    description: "Adds a multipart form field as literal text.",
    valueTitle: "Form field",
    valueDescription: "Multipart field definition.",
  },
  request: {
    title: "Explicit method",
    description: "Sets the HTTP method explicitly.",
    valueTitle: "Method value",
    valueDescription: "HTTP method requested by -X or --request.",
  },
  user: {
    title: "Basic auth",
    description: "Adds credentials for HTTP authentication.",
    valueTitle: "Credentials",
    valueDescription: "Credential value redacted.",
    sensitiveValue: true,
  },
  cookie: {
    title: "Cookie input",
    description: "Adds cookies directly or reads them from a cookie file.",
    valueTitle: "Cookie value",
    valueDescription: "Cookie value or cookie file path; sensitive values are redacted.",
    sensitiveValue: true,
  },
  "cookie-jar": {
    title: "Cookie jar",
    description: "Writes cookies to a cookie jar path.",
    valueTitle: "Cookie jar path",
    valueDescription: "Cookie jar file path.",
  },
  proxy: {
    title: "Proxy",
    description: "Routes the transfer through a proxy.",
    valueTitle: "Proxy URL",
    valueDescription: "Proxy URL used for the request.",
  },
  verbose: {
    title: "Verbose output",
    description: "Asks curl to include detailed transfer logging.",
  },
  fail: {
    title: "Fail on HTTP errors",
    description: "Makes curl fail the transfer on HTTP error status codes.",
  },
  silent: {
    title: "Silent mode",
    description: "Suppresses curl progress and error output.",
  },
  "show-error": {
    title: "Show errors",
    description: "Shows curl errors even when silent mode is enabled.",
  },
  insecure: {
    title: "TLS verification disabled",
    description: "Disables certificate verification for TLS connections.",
  },
  location: {
    title: "Follow redirects",
    description: "Allows curl to follow HTTP redirects.",
  },
  "proto-default": {
    title: "Default URL scheme",
    description: "Sets the scheme curl applies to URLs that omit one.",
    valueTitle: "Default scheme",
    valueDescription: "Scheme applied to URLs without an explicit scheme.",
  },
  http2: {
    title: "HTTP/2 intent",
    description: "Requests HTTP/2 where the target runtime supports it.",
  },
  "http2-prior-knowledge": {
    title: "HTTP/2 prior knowledge",
    description: "Requests HTTP/2 without an HTTP/1.1 upgrade path.",
  },
  http3: {
    title: "HTTP/3 intent",
    description: "Requests HTTP/3 where the target runtime supports it.",
  },
  "upload-file": {
    title: "Upload source",
    description: "Uploads data from a file path.",
    valueTitle: "Upload path",
    valueDescription: "File path used as upload input.",
  },
  netrc: {
    title: "netrc credentials",
    description: "Reads credentials from the default netrc file.",
  },
  "netrc-optional": {
    title: "Optional netrc credentials",
    description: "Reads credentials from netrc when available.",
  },
  "netrc-file": {
    title: "netrc file",
    description: "Reads credentials from a specific netrc file.",
    valueTitle: "netrc path",
    valueDescription: "Credential file path.",
    sensitiveValue: true,
  },
};

function events(parseResult: ParseOutput | null): ParseEvent[] {
  const value = parseResult?.events;
  return Array.isArray(value) ? (value as ParseEvent[]) : [];
}

function externalRefs(parseResult: ParseOutput | null): ExternalRef[] {
  const value = parseResult?.ir?.externalRefs;
  return Array.isArray(value) ? (value as ExternalRef[]) : [];
}

function looksLikeUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/iu.test(value);
}

function sourceLabel(start?: number, end?: number): string {
  return start === undefined || end === undefined ? "source span unavailable" : `source ${start}-${end}`;
}

function hasSensitiveHeader(value: string): boolean {
  return /^(authorization|cookie|set-cookie)\s*:/iu.test(value);
}

function displayValue(value: string, sensitive: boolean): string {
  return sensitive || hasSensitiveHeader(value) ? "redacted" : value;
}

function canonicalDisplay(canonical?: string | null): string | undefined {
  return canonical ? `--${canonical}` : undefined;
}

function isShortFlagBundle(token: string): boolean {
  return /^-[^-].+/u.test(token);
}

function shortFlagForEvent(
  event: ParseEvent,
  token: string,
  bundleOffsets: Map<number, number>,
): string | undefined {
  if (!isShortFlagBundle(token) || typeof event.argvIndex !== "number") {
    return undefined;
  }
  const offset = bundleOffsets.get(event.argvIndex) ?? 0;
  const flag = token[offset + 1];
  if (!flag) {
    return undefined;
  }
  bundleOffsets.set(event.argvIndex, offset + 1);
  return `-${flag}`;
}

function fallbackExplanation(index: number, token: string): OptionDescription {
  if (index === 0 && token === "curl") {
    return {
      title: "CLI program",
      description: "Invokes curl.",
    };
  }
  if (looksLikeUrl(token)) {
    return {
      title: "Request URL",
      description: "Request URL.",
    };
  }
  if (token.startsWith("-")) {
    return {
      title: "Parsed argument",
      description: "Option parsed from the curl command.",
    };
  }
  return {
    title: "Parsed argument",
    description: "Value parsed from the curl command.",
  };
}

function describeEvent(event: ParseEvent): OptionDescription {
  if (event.isPositional) {
    return {
      title: "Request URL",
      description: "Request URL.",
    };
  }

  const canonical = event.canonical ?? undefined;
  if (canonical && optionDescriptions[canonical]) {
    return optionDescriptions[canonical];
  }

  return {
    title: "Parsed argument",
    description: "Option parsed from the curl command.",
    valueTitle: "Argument value",
    valueDescription: canonical
      ? `Value for canonical option ${canonical}.`
      : "Value associated with this option.",
  };
}

export function explainCommand(
  shellResult: ShellParseResult | null,
  parseResult: ParseOutput | null,
): CommandExplanation[] {
  const argv = shellResult?.input.argv ?? [];
  const spans = shellResult?.input.argvSpans ?? [];
  const rows: CommandExplanation[] = [];
  const externalRefsByIndex = new Map<number, ExternalRef[]>();
  const eventIndexes = new Set<number>();
  const valueIndexes = new Set<number>();

  for (const ref of externalRefs(parseResult)) {
    const index = ref.source?.argvIndex;
    if (typeof index !== "number") {
      continue;
    }
    const items = externalRefsByIndex.get(index) ?? [];
    items.push(ref);
    externalRefsByIndex.set(index, items);
  }

  const parseEvents = events(parseResult);
  const bundleOffsets = new Map<number, number>();

  for (const [eventIndex, event] of parseEvents.entries()) {
    if (typeof event.argvIndex === "number") {
      eventIndexes.add(event.argvIndex);
    }
    const valueIndex = event.valueArgvIndex;
    if (
      event.usedNextArg &&
      typeof valueIndex === "number" &&
      valueIndex !== event.argvIndex &&
      valueIndex >= 0
    ) {
      valueIndexes.add(valueIndex);
    }
  }

  for (const [index, token] of argv.entries()) {
    if (eventIndexes.has(index) || valueIndexes.has(index)) {
      continue;
    }
    const fallback = fallbackExplanation(index, token);
    rows.push({
      id: `argv-${index}`,
      argvIndex: index,
      token,
      displayToken: displayValue(token, false),
      title: fallback.title,
      description: `${fallback.description} ${sourceLabel(spans[index]?.start, spans[index]?.end)}.`,
      span: spans[index],
      externalRefs: externalRefsByIndex.get(index),
      severity: externalRefsByIndex.has(index) ? "warning" : "default",
    });
  }

  for (const [eventIndex, event] of parseEvents.entries()) {
    if (typeof event.argvIndex !== "number") {
      continue;
    }
    const option = describeEvent(event);
    const token = argv[event.argvIndex] ?? String(event.rawFlag ?? "");
    const sourceToken = String(event.rawFlag ?? token);
    const shortFlag = shortFlagForEvent(event, sourceToken, bundleOffsets);
    const displayToken = shortFlag ?? sourceToken;
    rows.push({
      id: `event-${eventIndex}-argv-${event.argvIndex}`,
      argvIndex: event.argvIndex,
      eventIndex,
      token,
      displayToken: displayValue(displayToken, false),
      sourceToken,
      shortFlag,
      title: option.title,
      description: `${option.description} ${sourceLabel(
        spans[event.argvIndex]?.start,
        spans[event.argvIndex]?.end,
      )}.`,
      canonical: canonicalDisplay(event.canonical),
      span: spans[event.argvIndex],
      externalRefs: externalRefsByIndex.get(event.argvIndex),
      severity: externalRefsByIndex.has(event.argvIndex) ? "warning" : "default",
    });

    const valueIndex = event.valueArgvIndex;
    if (
      event.usedNextArg &&
      typeof valueIndex === "number" &&
      valueIndex !== event.argvIndex &&
      valueIndex >= 0
    ) {
      const valueToken = argv[valueIndex] ?? String(event.value ?? "");
      const refs = externalRefsByIndex.get(valueIndex);
      rows.push({
        id: `event-${eventIndex}-value-${valueIndex}`,
        argvIndex: valueIndex,
        eventIndex,
        token: valueToken,
        displayToken: displayValue(valueToken, Boolean(option.sensitiveValue)),
        title: option.valueTitle ?? "Argument value",
        description: `${option.valueDescription ?? "Value associated with the preceding option."} ${sourceLabel(
          spans[valueIndex]?.start,
          spans[valueIndex]?.end,
        )}.`,
        canonical: canonicalDisplay(event.canonical),
        span: spans[valueIndex],
        externalRefs: refs,
        severity: refs ? "warning" : "default",
      });
    }
  }

  return rows.sort(
    (left, right) =>
      left.argvIndex - right.argvIndex ||
      (left.eventIndex ?? -1) - (right.eventIndex ?? -1) ||
      left.id.localeCompare(right.id),
  );
}
