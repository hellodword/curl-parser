import { extractBehaviors, type TransferBehaviors } from "./behavior_extractor.js";
import { assertBehaviorId, type BehaviorId, type CapabilityLevel } from "./behaviors.js";
import { getBehaviorCapability, type TargetBehaviorCapability } from "./capabilities/index.js";
import type { Diagnostic, GenerateInput, GenerateOutput, SupportItem, Target } from "../types.js";

type PlanCapability = CapabilityLevel;
type DiagnosticCode =
  | "E_TARGET_UNSUPPORTED"
  | "E_TARGET_URL_SCHEME_UNSUPPORTED"
  | "E_TARGET_EXTERNAL_REF_UNSUPPORTED"
  | "W_TARGET_HELPER_REQUIRED"
  | "W_TARGET_LOSSY"
  | "W_TARGET_RUNTIME_DIFFERENCE"
  | "W_TARGET_UNSAFE";

type DiagnosticCategory = NonNullable<Diagnostic["category"]>;
type RuntimeHelpersMode = "allow" | "inline" | "forbid";

interface PlanDiagnostic {
  code: DiagnosticCode;
  severity: Diagnostic["severity"];
  category: DiagnosticCategory;
}

interface PlanIssue {
  behavior: BehaviorId;
  level: Exclude<PlanCapability, "native">;
  message: string;
  diagnostic?: PlanDiagnostic;
}

interface PlanState {
  target: Target;
  issues: PlanIssue[];
  hasLossy: boolean;
  hasRuntimeHelper: boolean;
  hasUnsupported: boolean;
}

const HTTP_URL_PATTERN = /^https?:\/\//i;
const UNSUPPORTED_URL_SCHEME_MESSAGE = "Target does not support this URL scheme.";
const BROWSER_EXTERNAL_REF_MESSAGE = "Browser fetch cannot access local external references.";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function proxyIsSocks(value: unknown): boolean {
  const proxy = asRecord(value);
  if (!proxy) {
    return false;
  }
  const mode = asString(proxy.mode) ?? "";
  const url = asString(proxy.url) ?? "";
  return mode.startsWith("socks") || /^socks(?:4a?|5h?)?:/iu.test(url);
}

function proxyNeedsCustomAgent(value: unknown): boolean {
  const proxy = asRecord(value);
  if (!proxy) {
    return false;
  }
  return proxyIsSocks(proxy) ||
    (Array.isArray(proxy.headers) && proxy.headers.length > 0) ||
    Boolean(asRecord(proxy.tls));
}

function runtimeHelpers(input: GenerateInput): RuntimeHelpersMode {
  return input.options?.runtimeHelpers ?? "allow";
}

function behaviorCapability(state: PlanState, behavior: BehaviorId): TargetBehaviorCapability {
  return getBehaviorCapability(state.target, behavior);
}

function nonNativeMessage(capability: TargetBehaviorCapability): string | undefined {
  return capability.capability === "native" ? undefined : capability.message;
}

function defaultBehaviorStep(
  state: PlanState,
  behavior: BehaviorId,
  diagnostic?: PlanDiagnostic,
): GenerateOutput["plan"]["transfers"][number]["steps"][number] {
  const capability = behaviorCapability(state, behavior);
  return planStep(
    state,
    behavior,
    capability.capability,
    nonNativeMessage(capability),
    diagnostic,
  );
}

function supportLevel(state: PlanState): GenerateOutput["support"]["level"] {
  if (state.hasUnsupported) {
    return "unsupported";
  }
  if (state.hasRuntimeHelper) {
    return "requires-runtime-helper";
  }
  if (state.hasLossy) {
    return "lossy";
  }
  return "exact";
}

function errorDiagnostic(code: DiagnosticCode = "E_TARGET_UNSUPPORTED"): PlanDiagnostic {
  return {
    code,
    severity: "error",
    category: "target",
  };
}

function warningDiagnostic(
  code: DiagnosticCode,
  category: DiagnosticCategory = "target",
): PlanDiagnostic {
  return {
    code,
    severity: "warning",
    category,
  };
}

function recordPlanIssue(
  state: PlanState,
  behavior: BehaviorId,
  capability: PlanCapability,
  message?: string,
  diagnostic?: PlanDiagnostic,
): void {
  assertBehaviorId(behavior);
  if (capability === "native") {
    return;
  }

  if (capability === "lossy") {
    state.hasLossy = true;
  } else if (capability === "requires-runtime-helper") {
    state.hasRuntimeHelper = true;
  } else if (capability === "unsupported") {
    state.hasUnsupported = true;
  }

  const issue: PlanIssue = {
    behavior,
    level: capability,
    message: message ?? "",
    diagnostic: diagnostic ?? (capability === "unsupported" ? errorDiagnostic() : undefined),
  };
  if (!state.issues.some((item) =>
    item.behavior === issue.behavior &&
    item.level === issue.level &&
    item.message === issue.message &&
    item.diagnostic?.code === issue.diagnostic?.code &&
    item.diagnostic?.severity === issue.diagnostic?.severity &&
    item.diagnostic?.category === issue.diagnostic?.category
  )) {
    state.issues.push(issue);
  }
}

function planStep(
  state: PlanState,
  behavior: BehaviorId,
  capability: PlanCapability,
  message?: string,
  diagnostic?: PlanDiagnostic,
): GenerateOutput["plan"]["transfers"][number]["steps"][number] {
  assertBehaviorId(behavior);
  behaviorCapability(state, behavior);
  recordPlanIssue(state, behavior, capability, message, diagnostic);
  return message
    ? { behavior, capability, message }
    : { behavior, capability };
}

function urlStep(
  input: GenerateInput,
  transfer: TransferBehaviors,
  state: PlanState,
): GenerateOutput["plan"]["transfers"][number]["steps"][number] {
  if (!HTTP_URL_PATTERN.test(transfer.transfer.url)) {
    const capability = behaviorCapability(state, "url.scheme");
    return planStep(
      state,
      "url.scheme",
      capability.capability,
      capability.capability === "native" ? undefined : UNSUPPORTED_URL_SCHEME_MESSAGE,
      capability.capability === "unsupported"
        ? errorDiagnostic("E_TARGET_URL_SCHEME_UNSUPPORTED")
        : undefined,
    );
  }
  return defaultBehaviorStep(state, "url");
}

function headersStep(
  input: GenerateInput,
  transfer: TransferBehaviors,
  state: PlanState,
): GenerateOutput["plan"]["transfers"][number]["steps"][number] {
  if (!transfer.hasDuplicateHeaders) {
    return defaultBehaviorStep(state, "headers");
  }
  void input;
  const capability = behaviorCapability(state, "headers");
  if (capability.unsafeWhen) {
    return planStep(
      state,
      "headers",
      "lossy",
      capability.unsafeWhen,
      warningDiagnostic("W_TARGET_LOSSY"),
    );
  }
  return defaultBehaviorStep(state, "headers");
}

function inlineCookiesStep(
  input: GenerateInput,
  state: PlanState,
): GenerateOutput["plan"]["transfers"][number]["steps"][number] {
  void input;
  const capability = behaviorCapability(state, "cookies.inline");
  return planStep(
    state,
    "cookies.inline",
    capability.capability,
    nonNativeMessage(capability),
    capability.capability === "lossy"
      ? warningDiagnostic("W_TARGET_RUNTIME_DIFFERENCE")
      : undefined,
  );
}

function cookieJarStep(
  input: GenerateInput,
  state: PlanState,
): GenerateOutput["plan"]["transfers"][number]["steps"][number] {
  const defaultCapability = behaviorCapability(state, "cookies.jar");
  const helpersForbidden = runtimeHelpers(input) === "forbid" &&
    defaultCapability.capability === "requires-runtime-helper";
  const capability = helpersForbidden ? "unsupported" : defaultCapability.capability;
  return planStep(
    state,
    "cookies.jar",
    capability,
    helpersForbidden
      ? "Runtime helpers are disabled for external references"
      : nonNativeMessage(defaultCapability),
    capability === "requires-runtime-helper"
      ? warningDiagnostic("W_TARGET_HELPER_REQUIRED", "support")
      : helpersForbidden
      ? errorDiagnostic("E_TARGET_EXTERNAL_REF_UNSUPPORTED")
      : undefined,
  );
}

function planTransfer(
  input: GenerateInput,
  transfer: TransferBehaviors,
  state: PlanState,
  hasExternalRefs: boolean,
  hasFilesystemRefs: boolean,
): GenerateOutput["plan"]["transfers"][number] {
  const steps: GenerateOutput["plan"]["transfers"][number]["steps"] = [
    urlStep(input, transfer, state),
    defaultBehaviorStep(state, "method"),
    headersStep(input, transfer, state),
  ];

  if (transfer.hasBody && transfer.bodyBehavior) {
    steps.push(defaultBehaviorStep(state, transfer.bodyBehavior));
  }
  if (transfer.hasAuth) {
    steps.push(defaultBehaviorStep(state, "auth.basic"));
  }
  if (transfer.hasInlineCookies) {
    steps.push(inlineCookiesStep(input, state));
  }
  if (transfer.hasCookieJar) {
    steps.push(cookieJarStep(input, state));
  }
  if (transfer.hasProxy) {
    const defaultCapability = behaviorCapability(state, "proxy");
    const proxy = asRecord(transfer.transfer.effective)?.proxy;
    const capability: PlanCapability = input.target === "js.axios" &&
        proxyNeedsCustomAgent(proxy) &&
        defaultCapability.capability === "native"
      ? "requires-runtime-helper"
      : defaultCapability.capability;
    steps.push(planStep(
      state,
      "proxy",
      capability,
      capability === "native"
        ? undefined
        : capability === "unsupported" && input.target === "js.fetch"
          ? "Target cannot preserve curl-style proxy selection"
        : input.target === "js.axios"
          ? "Target requires custom Axios proxy agent wiring for this proxy mode"
          : defaultCapability.message,
    ));
  }
  if (transfer.hasTlsVerifyFalse) {
    const defaultCapability = behaviorCapability(state, "tls.verify");
    const rustUnsafe = input.target === "rust.reqwest" && defaultCapability.capability === "native";
    const capability = rustUnsafe ? "lossy" : defaultCapability.capability;
    steps.push(planStep(
      state,
      "tls.verify",
      capability,
      rustUnsafe
        ? "Generated reqwest code disables TLS certificate validation; this is unsafe outside controlled replay."
        : nonNativeMessage(defaultCapability),
      rustUnsafe ? warningDiagnostic("W_TARGET_UNSAFE") : undefined,
    ));
  }
  if (transfer.hasTlsCa) {
    const capability = behaviorCapability(state, "tls.ca");
    steps.push(planStep(
      state,
      "tls.ca",
      capability.capability,
      nonNativeMessage(capability),
    ));
  }
  if (transfer.hasTlsClientCert) {
    const capability = behaviorCapability(state, "tls.client-cert");
    steps.push(planStep(
      state,
      "tls.client-cert",
      capability.capability,
      nonNativeMessage(capability),
    ));
  }
  if (transfer.hasNetwork) {
    const capability = behaviorCapability(state, "network");
    steps.push(planStep(
      state,
      "network",
      capability.capability,
      nonNativeMessage(capability),
    ));
  }
  if (transfer.hasDns) {
    const capability = behaviorCapability(state, "dns");
    steps.push(planStep(
      state,
      "dns",
      capability.capability,
      nonNativeMessage(capability),
    ));
  }
  if (transfer.hasRedirects) {
    const capability = behaviorCapability(state, "redirects");
    steps.push(planStep(
      state,
      "redirects",
      capability.capability,
      nonNativeMessage(capability),
    ));
  }
  if (transfer.hasTimeouts) {
    const capability = behaviorCapability(state, "timeout");
    steps.push(planStep(
      state,
      "timeout",
      capability.capability,
      nonNativeMessage(capability),
    ));
  }
  if (transfer.hasDebug) {
    const capability = behaviorCapability(state, "debug");
    steps.push(planStep(
      state,
      "debug",
      capability.capability,
      nonNativeMessage(capability),
      capability.capability === "lossy" ? warningDiagnostic("W_TARGET_LOSSY") : undefined,
    ));
  }
  if (transfer.httpVersion === "2") {
    const defaultCapability = behaviorCapability(state, "http.version.2");
    let capability: PlanCapability = defaultCapability.capability;
    let message: string | undefined = nonNativeMessage(defaultCapability);
    if (input.target === "go.net_http" && defaultCapability.capability === "native") {
      const httpVersion = asRecord(transfer.transfer.effective)?.httpVersion;
      if (asString(asRecord(httpVersion)?.policy) === "prior-knowledge") {
        capability = "lossy";
        message = "net/http does not exactly preserve curl HTTP/2 prior knowledge without custom transport wiring";
      } else {
        message = "Generated custom Go transports set ForceAttemptHTTP2 when proxy, TLS, DNS, or network settings require a transport.";
      }
    }
    steps.push(planStep(
      state,
      "http.version.2",
      capability,
      message,
      capability === "lossy" ? warningDiagnostic("W_TARGET_LOSSY") : undefined,
    ));
  }
  if (transfer.httpVersion === "3") {
    const capability = behaviorCapability(state, "http.version.3");
    steps.push(planStep(
      state,
      "http.version.3",
      capability.capability,
      capability.capability === "native" ? undefined : "Target cannot preserve HTTP/3 selection",
    ));
  }
  if (hasExternalRefs) {
    const defaultCapability = behaviorCapability(state, "external-ref");
    const helpersForbidden = runtimeHelpers(input) === "forbid";
    const fetchHelperAllowed = input.target === "js.fetch" &&
      input.options?.runtimeHelpers === "allow";
    const browserUnsupported = input.target === "js.fetch" &&
      (hasFilesystemRefs || hasExternalRefs) &&
      !fetchHelperAllowed;
    const capability: PlanCapability = browserUnsupported || helpersForbidden
      ? "unsupported"
      : fetchHelperAllowed && defaultCapability.capability === "unsupported"
      ? "requires-runtime-helper"
      : defaultCapability.capability;
    steps.push(planStep(
      state,
      "external-ref",
      capability,
      helpersForbidden
        ? "Runtime helpers are disabled for external references"
        : browserUnsupported
        ? BROWSER_EXTERNAL_REF_MESSAGE
        : input.target === "js.fetch"
        ? "Generated browser fetch code needs caller-provided external reference loaders"
        : nonNativeMessage(defaultCapability),
      browserUnsupported || helpersForbidden
        ? errorDiagnostic("E_TARGET_EXTERNAL_REF_UNSUPPORTED")
        : undefined,
    ));
  }

  return {
    id: transfer.transfer.id,
    steps,
  };
}

function targetDiagnostic(input: GenerateInput, issue: PlanIssue): Diagnostic {
  return {
    code: issue.diagnostic?.code ?? "E_TARGET_UNSUPPORTED",
    severity: issue.diagnostic?.severity ?? "error",
    category: issue.diagnostic?.category ?? "target",
    message: issue.message,
    details: {
      target: input.target,
      behavior: issue.behavior,
    },
  };
}

export function planSupport(input: GenerateInput): GenerateOutput {
  const state: PlanState = {
    target: input.target,
    issues: [],
    hasLossy: false,
    hasRuntimeHelper: false,
    hasUnsupported: false,
  };
  const extracted = extractBehaviors(input.ir);
  const transfers = extracted.transfers.map((transfer) =>
    planTransfer(
      input,
      transfer,
      state,
      extracted.hasExternalRefs,
      extracted.hasFilesystemRefs,
    ),
  );
  const supportItems: SupportItem[] = state.issues.map((issue) => ({
    behavior: issue.behavior,
    level: issue.level,
    message: issue.message,
  }));

  return {
    schemaVersion: "curl-generate-output/v2",
    target: input.target,
    files: [],
    plan: {
      target: input.target,
      transfers: transfers.length > 0
        ? transfers
        : [{
            id: "transfer-0",
            steps: [
              defaultBehaviorStep(state, "url"),
              defaultBehaviorStep(state, "method"),
              defaultBehaviorStep(state, "headers"),
            ],
          }],
    },
    support: {
      level: supportLevel(state),
      items: supportItems,
    },
    diagnostics: state.issues
      .filter((issue) => issue.diagnostic !== undefined)
      .map((issue) => targetDiagnostic(input, issue)),
  };
}
