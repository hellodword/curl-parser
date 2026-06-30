import { TARGETS } from "./generated/types.js";
import type { Target } from "./types.js";

export const targets = TARGETS satisfies readonly Target[];

export const schemaCatalog = {
  parseInputV2: {
    id: "https://schemas.curl-parser.dev/parse-input.v2.schema.json",
    path: "schemas/parse-input.v2.schema.json",
  },
  parseOutputV2: {
    id: "https://schemas.curl-parser.dev/parse-output.v2.schema.json",
    path: "schemas/parse-output.v2.schema.json",
  },
  curlIrV2: {
    id: "https://schemas.curl-parser.dev/curl-ir.v2.schema.json",
    path: "schemas/curl-ir.v2.schema.json",
  },
  diagnosticsV2: {
    id: "https://schemas.curl-parser.dev/diagnostics.v2.schema.json",
    path: "schemas/diagnostics.v2.schema.json",
  },
  generateInputV2: {
    id: "https://schemas.curl-parser.dev/generate-input.v2.schema.json",
    path: "schemas/generate-input.v2.schema.json",
  },
  generateOutputV2: {
    id: "https://schemas.curl-parser.dev/generate-output.v2.schema.json",
    path: "schemas/generate-output.v2.schema.json",
  },
  runtimeProfileV2: {
    id: "https://schemas.curl-parser.dev/runtime-profile.v2.schema.json",
    path: "schemas/runtime-profile.v2.schema.json",
  },
  targetCapabilitiesV2: {
    id: "https://schemas.curl-parser.dev/target-capabilities.v2.schema.json",
    path: "schemas/target-capabilities.v2.schema.json",
  },
} as const;

export type SchemaName = keyof typeof schemaCatalog;

export function listTargets(): readonly Target[] {
  return [...targets];
}

export function listSchemaExports(): readonly SchemaName[] {
  return Object.keys(schemaCatalog) as SchemaName[];
}
