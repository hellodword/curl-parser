import type { CurlIr, CurlIrTransfer } from "../types.js";

export interface TransferBehaviors {
  transfer: CurlIrTransfer;
  hasBody: boolean;
  bodyBehavior: "body.raw" | "body.multipart" | undefined;
  hasAuth: boolean;
  hasInlineCookies: boolean;
  hasCookieJar: boolean;
  hasDuplicateHeaders: boolean;
  hasProxy: boolean;
  hasTlsVerifyFalse: boolean;
  hasTlsCa: boolean;
  hasTlsClientCert: boolean;
  hasNetwork: boolean;
  hasDns: boolean;
  hasRedirects: boolean;
  hasTimeouts: boolean;
  hasDebug: boolean;
  httpVersion: string | undefined;
}

export interface ExtractedBehaviors {
  transfers: TransferBehaviors[];
  hasExternalRefs: boolean;
  hasFilesystemRefs: boolean;
}

const FILESYSTEM_EXTERNAL_REF_KINDS = new Set([
  "file",
  "stdin",
  "directory",
  "output-file",
  "cookie-jar",
  "trace-output",
  "header-output",
  "tls-ca-file",
  "tls-client-cert",
  "tls-client-key",
  "proxy-client-cert",
  "proxy-client-key",
  "local-file-url",
  "dns-interface",
  "network-interface",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function effective(transfer: CurlIrTransfer): Record<string, unknown> {
  return isRecord(transfer.effective) ? transfer.effective : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function httpVersionValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (isRecord(value) && typeof value.value === "string") {
    return value.value;
  }
  return undefined;
}

function bodyBehavior(value: unknown): "body.raw" | "body.multipart" | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const kind = asString(value.kind);
  return kind === "form" || kind === "form-string" ? "body.multipart" : "body.raw";
}

function hasDuplicateHeaders(value: unknown): boolean {
  const seen = new Set<string>();
  for (const item of asArray(value)) {
    const header = isRecord(item) ? item : {};
    const name = asString(header.name);
    if (!name) {
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      return true;
    }
    seen.add(key);
  }
  return false;
}

function hasInlineCookies(value: unknown): boolean {
  return asArray(value).some((item) => {
    const cookie = isRecord(item) ? item : {};
    return typeof cookie.value === "string" && cookie.value.length > 0;
  });
}

function hasCookieJar(value: unknown): boolean {
  return asArray(value).some((item) => {
    const cookie = isRecord(item) ? item : {};
    return typeof cookie.externalRefId === "string" && cookie.externalRefId.length > 0;
  });
}

function hasDebug(value: unknown): boolean {
  return hasObjectFields(value);
}

function hasObjectFields(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length > 0;
}

function hasTlsCa(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.caFileRefId === "string" ||
    typeof value.caPathRefId === "string" ||
    typeof value.caBundle === "string" ||
    value.useNativeCa === true ||
    typeof value.pinnedPublicKeyRefId === "string";
}

function hasTlsClientCert(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.clientCertRefId === "string" ||
    typeof value.clientKeyRefId === "string" ||
    typeof value.clientCert === "string" ||
    typeof value.clientKey === "string";
}

export function extractBehaviors(ir: CurlIr): ExtractedBehaviors {
  return {
    transfers: ir.groups.flatMap((group) =>
      group.transfers.map((transfer) => {
        const current = effective(transfer);
        const auth = current.auth;
        const cookies = current.cookies;
        const proxy = current.proxy;
        const tls = current.tls;
        const redirects = current.redirects;
        const body = current.body;

        return {
          transfer,
          hasBody: isRecord(body),
          bodyBehavior: bodyBehavior(body),
          hasAuth: isRecord(auth) && typeof auth.value === "string",
          hasInlineCookies: hasInlineCookies(cookies),
          hasCookieJar: hasCookieJar(cookies),
          hasDuplicateHeaders: hasDuplicateHeaders(current.headers),
          hasProxy: isRecord(proxy) && typeof proxy.url === "string",
          hasTlsVerifyFalse: isRecord(tls) && tls.verify === false,
          hasTlsCa: hasTlsCa(tls),
          hasTlsClientCert: hasTlsClientCert(tls),
          hasNetwork: hasObjectFields(current.network),
          hasDns: hasObjectFields(current.dns),
          hasRedirects: isRecord(redirects) &&
            (redirects.follow === true || typeof redirects.max === "number"),
          hasTimeouts: isRecord(current.timeouts),
          hasDebug: hasDebug(current.debug),
          httpVersion: httpVersionValue(current.httpVersion),
        };
      }),
    ),
    hasExternalRefs: ir.externalRefs.length > 0,
    hasFilesystemRefs: ir.externalRefs.some((ref) =>
      FILESYSTEM_EXTERNAL_REF_KINDS.has(ref.kind),
    ),
  };
}
