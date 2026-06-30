export const CAPABILITY_LEVELS = [
  "native",
  "lossy",
  "requires-runtime-helper",
  "unsupported",
] as const;

export type CapabilityLevel = (typeof CAPABILITY_LEVELS)[number];

interface BehaviorDefinition {
  id: string;
  description: string;
  enabled: boolean;
}

export const BEHAVIOR_REGISTRY = [
  {
    id: "url",
    description: "HTTP request URL is represented by the target.",
    enabled: true,
  },
  {
    id: "url.scheme",
    description: "URL scheme is supported by the target transport.",
    enabled: true,
  },
  {
    id: "method",
    description: "HTTP request method is represented by the target.",
    enabled: true,
  },
  {
    id: "headers",
    description: "HTTP request headers are represented by the target.",
    enabled: true,
  },
  {
    id: "body.raw",
    description: "Raw request body content is represented by the target.",
    enabled: true,
  },
  {
    id: "body.multipart",
    description: "Multipart request body content is represented by the target.",
    enabled: true,
  },
  {
    id: "auth.basic",
    description: "Basic authentication is represented by the target.",
    enabled: true,
  },
  {
    id: "cookies.inline",
    description: "Inline cookie headers or cookie values are represented by the target.",
    enabled: true,
  },
  {
    id: "cookies.jar",
    description: "Cookie jar files are represented by the target.",
    enabled: true,
  },
  {
    id: "proxy",
    description: "Proxy selection is represented by the target.",
    enabled: true,
  },
  {
    id: "tls.verify",
    description: "TLS verification behavior is represented by the target.",
    enabled: true,
  },
  {
    id: "tls.ca",
    description: "TLS CA trust material is represented by the target.",
    enabled: true,
  },
  {
    id: "tls.client-cert",
    description: "TLS client certificate and key material are represented by the target.",
    enabled: true,
  },
  {
    id: "network",
    description: "Low-level network selection is represented by the target.",
    enabled: true,
  },
  {
    id: "dns",
    description: "DNS override and resolver behavior is represented by the target.",
    enabled: true,
  },
  {
    id: "redirects",
    description: "Redirect policy is represented by the target.",
    enabled: true,
  },
  {
    id: "timeout",
    description: "Timeout behavior is represented by the target.",
    enabled: true,
  },
  {
    id: "http.version.2",
    description: "HTTP/2 selection is represented by the target.",
    enabled: true,
  },
  {
    id: "http.version.3",
    description: "HTTP/3 selection is represented by the target.",
    enabled: true,
  },
  {
    id: "debug",
    description: "Verbose or trace debug behavior is represented by the target.",
    enabled: true,
  },
  {
    id: "external-ref",
    description: "External references are represented by generated code or runtime helpers.",
    enabled: true,
  },
] as const satisfies readonly BehaviorDefinition[];

export type BehaviorId = (typeof BEHAVIOR_REGISTRY)[number]["id"];

export const ENABLED_BEHAVIOR_IDS = BEHAVIOR_REGISTRY
  .filter((behavior) => behavior.enabled)
  .map((behavior) => behavior.id) as readonly BehaviorId[];

export const ENABLED_BEHAVIOR_ID_SET: ReadonlySet<string> = new Set(ENABLED_BEHAVIOR_IDS);

export function isBehaviorId(value: string): value is BehaviorId {
  return ENABLED_BEHAVIOR_ID_SET.has(value);
}

export function assertBehaviorId(value: string): asserts value is BehaviorId {
  if (!isBehaviorId(value)) {
    throw new Error(`Unknown generator behavior: ${value}`);
  }
}
