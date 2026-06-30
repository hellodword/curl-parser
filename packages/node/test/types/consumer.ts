import {
  createParser,
  listTargets,
  parseCurl,
  type CapabilityLevel,
  type CurlParser,
  type ExternalRef,
  type ExternalRefKind,
  type GenerateOutput,
  type ParseOutput,
  type SupportItem,
  type Target,
} from "@hellodword/curl-parser";
import { createParser as createBrowserParser } from "@hellodword/curl-parser/browser";
import { schemaCatalog } from "@hellodword/curl-parser/schemas";

const target: Target = listTargets()[0] ?? "js.fetch";
const schemaId: string = schemaCatalog.curlIrV2.id;
const externalKind: ExternalRefKind = "tls-client-cert";
const capabilityLevel: CapabilityLevel = "requires-runtime-helper";
const externalRef: ExternalRef = {
  id: "external-0",
  kind: "file",
  access: "read",
  option: "--data",
  value: "payload.txt",
  source: null,
};
const supportItem: SupportItem = {
  behavior: "external-ref",
  level: "requires-runtime-helper",
  message: "runtime helper required",
};
const generateOutput: GenerateOutput = {
  schemaVersion: "curl-generate-output/v2",
  target: "js.fetch",
  files: [],
  plan: { target: "js.fetch", transfers: [] },
  support: { level: "exact", items: [supportItem] },
  diagnostics: [],
};

// @ts-expect-error invalid generated target
const invalidTarget: Target = "c." + "libcurl";
// @ts-expect-error invalid external reference kind
const invalidKind: ExternalRefKind = "tls-client-material";
// @ts-expect-error support items cannot use aggregate support level
const invalidCapability: CapabilityLevel = "exact";
// @ts-expect-error support item required fields are generated from the schema
const invalidSupportItem: SupportItem = { behavior: "external-ref", level: "unsupported" };
// @ts-expect-error ExternalRef.kind must come from curl-ir v2 schema
const invalidExternalRef: ExternalRef = { ...externalRef, kind: "custom-file" };

async function useParser(parser: CurlParser): Promise<ParseOutput> {
  return parser.parseCurl(["curl", "https://example.com"]);
}

async function main(): Promise<void> {
  const parser = await createParser();
  try {
    await useParser(parser);
    await parseCurl("curl https://example.com", { shellDialect: "posix-sh" });
  } finally {
    parser.dispose();
  }

  await createBrowserParser({
    wasmBytes: new Uint8Array(),
    imports: {},
  }).catch(() => undefined);

  void target;
  void schemaId;
  void externalKind;
  void capabilityLevel;
  void generateOutput;
  void invalidTarget;
  void invalidKind;
  void invalidCapability;
  void invalidSupportItem;
  void invalidExternalRef;
}

void main;
