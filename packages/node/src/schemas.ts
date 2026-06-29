import type { Target } from "./types.js";

export const targets = [
  "c.libcurl",
  "python.requests",
  "js.fetch",
  "js.undici",
  "go.net_http",
  "rust.reqwest",
] as const satisfies readonly Target[];

export const schemaCatalog = {
  parseInputV1: {
    id: "https://schemas.curl-parser.dev/parse-input.v1.schema.json",
    path: "schemas/parse-input.v1.schema.json",
  },
  parseOutputV1: {
    id: "https://schemas.curl-parser.dev/parse-output.v1.schema.json",
    path: "schemas/parse-output.v1.schema.json",
  },
  curlIrV1: {
    id: "https://schemas.curl-parser.dev/curl-ir.v1.schema.json",
    path: "schemas/curl-ir.v1.schema.json",
  },
  diagnosticsV1: {
    id: "https://schemas.curl-parser.dev/diagnostics.v1.schema.json",
    path: "schemas/diagnostics.v1.schema.json",
  },
  generateInputV1: {
    id: "https://schemas.curl-parser.dev/generate-input.v1.schema.json",
    path: "schemas/generate-input.v1.schema.json",
  },
  generateOutputV1: {
    id: "https://schemas.curl-parser.dev/generate-output.v1.schema.json",
    path: "schemas/generate-output.v1.schema.json",
  },
  runtimeProfileV1: {
    id: "https://schemas.curl-parser.dev/runtime-profile.v1.schema.json",
    path: "schemas/runtime-profile.v1.schema.json",
  },
  targetCapabilitiesV1: {
    id: "https://schemas.curl-parser.dev/target-capabilities.v1.schema.json",
    path: "schemas/target-capabilities.v1.schema.json",
  },
} as const;

export type SchemaName = keyof typeof schemaCatalog;

export function listTargets(): readonly Target[] {
  return [...targets];
}

export function listSchemaExports(): readonly SchemaName[] {
  return Object.keys(schemaCatalog) as SchemaName[];
}
