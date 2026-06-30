#!/usr/bin/env python3
from __future__ import annotations

import json
import argparse
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_DIR = REPO_ROOT / "schemas"
CAPABILITY_DIR = REPO_ROOT / "generators" / "capabilities"
OUTPUT = REPO_ROOT / "packages" / "node" / "src" / "generated" / "types.ts"
CAPABILITIES_OUTPUT = REPO_ROOT / "packages" / "node" / "src" / "generated" / "capabilities.ts"
REQUIRED_SCHEMAS = [
    "parse-input.v2.schema.json",
    "parse-output.v2.schema.json",
    "curl-ir.v2.schema.json",
    "diagnostics.v2.schema.json",
    "generate-input.v2.schema.json",
    "generate-output.v2.schema.json",
    "runtime-profile.v2.schema.json",
    "target-capabilities.v2.schema.json",
]


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def quoted(values: list[str]) -> str:
    return ", ".join(json.dumps(value) for value in values)


def string_union(values: list[str]) -> str:
    return " | ".join(json.dumps(value) for value in values)


def read_path(payload: Any, path: tuple[str, ...], source: Path) -> Any:
    current = payload
    for key in path:
        if not isinstance(current, dict) or key not in current:
            joined = ".".join(path)
            raise SystemExit(f"{source.name}: missing {joined}")
        current = current[key]
    return current


def string_list(value: Any, source: Path, field: str) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise SystemExit(f"{source.name}: {field} must be string[]")
    return value


def schema_const(schema: dict[str, Any], source: Path) -> str:
    value = read_path(schema, ("properties", "schemaVersion", "const"), source)
    if not isinstance(value, str):
        raise SystemExit(f"{source.name}: schemaVersion const must be string")
    return value


def support_item_field(
    required: set[str],
    name: str,
    field_type: str,
) -> str:
    optional = "" if name in required else "?"
    return f"  {name}{optional}: {field_type};"


def load_schemas() -> dict[str, dict[str, Any]]:
    missing = [name for name in REQUIRED_SCHEMAS if not (SCHEMA_DIR / name).is_file()]
    if missing:
        raise SystemExit(f"missing v2 schemas: {', '.join(missing)}")

    schemas: dict[str, dict[str, Any]] = {}
    for name in REQUIRED_SCHEMAS:
        payload = load_json(SCHEMA_DIR / name)
        if not isinstance(payload, dict):
            raise SystemExit(f"{name} must be an object")
        schemas[name] = payload
    return schemas


def render_types(schemas: dict[str, dict[str, Any]]) -> tuple[str, list[str]]:
    generate_input_path = SCHEMA_DIR / "generate-input.v2.schema.json"
    curl_ir_path = SCHEMA_DIR / "curl-ir.v2.schema.json"
    target_capabilities_path = SCHEMA_DIR / "target-capabilities.v2.schema.json"
    generate_output_path = SCHEMA_DIR / "generate-output.v2.schema.json"

    generate_input = schemas["generate-input.v2.schema.json"]
    curl_ir = schemas["curl-ir.v2.schema.json"]
    target_capabilities = schemas["target-capabilities.v2.schema.json"]
    generate_output = schemas["generate-output.v2.schema.json"]

    target_enum = string_list(
        read_path(generate_input, ("$defs", "target", "enum"), generate_input_path),
        generate_input_path,
        "$defs.target.enum",
    )
    external_ref_kind_enum = string_list(
        read_path(curl_ir, ("$defs", "externalRef", "properties", "kind", "enum"), curl_ir_path),
        curl_ir_path,
        "$defs.externalRef.properties.kind.enum",
    )
    capability_enum = string_list(
        read_path(target_capabilities, ("$defs", "capability", "enum"), target_capabilities_path),
        target_capabilities_path,
        "$defs.capability.enum",
    )
    support_level_enum = string_list(
        read_path(
            generate_output,
            ("$defs", "supportReport", "properties", "level", "enum"),
            generate_output_path,
        ),
        generate_output_path,
        "$defs.supportReport.properties.level.enum",
    )
    support_item = read_path(
        generate_output,
        ("$defs", "supportReport", "properties", "items", "items"),
        generate_output_path,
    )
    if not isinstance(support_item, dict):
        raise SystemExit("generate-output.v2.schema.json: support item schema must be object")
    support_item_required = set(string_list(
        support_item.get("required"),
        generate_output_path,
        "$defs.supportReport.properties.items.items.required",
    ))
    support_item_level_enum = string_list(
        read_path(support_item, ("properties", "level", "enum"), generate_output_path),
        generate_output_path,
        "$defs.supportReport.properties.items.items.properties.level.enum",
    )

    parse_input_version = schema_const(schemas["parse-input.v2.schema.json"], SCHEMA_DIR / "parse-input.v2.schema.json")
    parse_output_version = schema_const(schemas["parse-output.v2.schema.json"], SCHEMA_DIR / "parse-output.v2.schema.json")
    curl_ir_version = schema_const(curl_ir, curl_ir_path)
    generate_input_version = schema_const(generate_input, generate_input_path)
    generate_output_version = schema_const(generate_output, generate_output_path)

    return f"""// Generated by scripts/build/generate_ts_types.py. Do not edit by hand.

export const TARGETS = [{quoted(target_enum)}] as const;
export type Target = (typeof TARGETS)[number];
export type ExternalRefKind = {string_union(external_ref_kind_enum)};
export type CapabilityLevel = {string_union(capability_enum)};
export type SupportLevel = {string_union(support_level_enum)};
export type SupportItemLevel = {string_union(support_item_level_enum)};

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {{
  [key: string]: JsonValue;
}}

export type ShellDialect = "bash" | "zsh" | "posix-sh" | "powershell" | "cmd" | "fish";
export type DiagnosticSeverity = "fatal" | "error" | "warning" | "info";

export interface SourceSpan {{
  source: "command" | "argv" | "generated";
  argvIndex?: number;
  start?: number;
  end?: number;
  path?: string;
}}

export interface Diagnostic {{
  code: string;
  severity: DiagnosticSeverity;
  category?: "input" | "shell" | "curl" | "profile" | "support" | "target" | "internal";
  message?: string;
  path?: string;
  option?: string | null;
  source?: SourceSpan;
  details?: Record<string, string | number | boolean | null>;
  detail?: string | null;
  warning?: boolean;
  [key: string]: unknown;
}}

export interface ParseInput {{
  schemaVersion: {json.dumps(parse_input_version)};
  inputMode: "argv" | "shell";
  argv?: string[];
  argvSpans?: SourceSpan[];
  command?: string;
  shellDialect?: ShellDialect;
  parseMode?: "strict" | "diagnostic";
  runtimeProfile?: unknown;
}}

export interface ShellParseResult {{
  input: ParseInput;
  diagnostics: Diagnostic[];
  shellDialect: ShellDialect;
}}

export interface CurlIrUrlResolution {{
  scheme: string;
  source: "curl-default" | "hostname-prefix" | "proto-default";
  normalized: string;
}}

export interface CurlIrTransfer {{
  id: string;
  index: number;
  url: string;
  rawUrl?: string;
  urlResolution?: CurlIrUrlResolution;
  effective: Record<string, unknown>;
  source?: SourceSpan;
  [key: string]: unknown;
}}

export interface CurlIrTransferGroup {{
  id: string;
  index: number;
  options: Record<string, unknown>;
  transfers: CurlIrTransfer[];
  source?: SourceSpan;
  [key: string]: unknown;
}}

export interface CurlIr {{
  schemaVersion: {json.dumps(curl_ir_version)};
  curlSourceVersion: string;
  command: Record<string, unknown>;
  externalRefs: ExternalRef[];
  runtime: Record<string, unknown>;
  globals: Record<string, unknown>;
  groups: CurlIrTransferGroup[];
  diagnostics: Diagnostic[];
}}

export interface ExternalRef {{
  id: string;
  kind: ExternalRefKind;
  access: string;
  option: string | null;
  value: string | null;
  source: SourceSpan | null;
}}

export interface SupportItem {{
{support_item_field(support_item_required, "behavior", "string")}
{support_item_field(support_item_required, "level", "SupportItemLevel")}
{support_item_field(support_item_required, "message", "string")}
  [key: string]: unknown;
}}

export interface SupportReport {{
  level: SupportLevel;
  items: SupportItem[];
}}

export interface ParseOutput {{
  ok: boolean;
  schemaVersion: {json.dumps(parse_output_version)};
  curlSourceVersion?: string;
  runtimeProfileApplied?: unknown;
  ir?: CurlIr;
  argv?: string[];
  operations?: unknown[];
  events?: unknown[];
  diagnostics: Diagnostic[];
  errors: Diagnostic[];
  [key: string]: unknown;
}}

export interface GenerateInputOptions {{
  secretMode?: "redact" | "env-ref" | "preserve";
  runtimeHelpers?: "allow" | "inline" | "forbid";
  style?: "sync" | "async";
  format?: boolean;
}}

export interface GenerateInput {{
  schemaVersion: {json.dumps(generate_input_version)};
  target: Target;
  ir: CurlIr;
  options?: GenerateInputOptions;
}}

export interface GeneratedFile {{
  path: string;
  content: string;
  role?: "main" | "helper" | "manifest" | "test" | "documentation";
}}

export interface RequestPlan {{
  target: Target;
  transfers: Array<{{
    id: string;
    steps: Array<{{
      behavior: string;
      capability: CapabilityLevel;
      message?: string;
    }}>;
  }}>;
}}

export interface GenerateOutput {{
  schemaVersion: {json.dumps(generate_output_version)};
  target: Target;
  files: GeneratedFile[];
  plan: RequestPlan;
  support: SupportReport;
  diagnostics: Diagnostic[];
}}

export interface ParseCurlOptions {{
  shellDialect?: ShellDialect;
  parseMode?: ParseInput["parseMode"];
  runtimeProfile?: unknown;
}}

export type ParseCurlInput = string | readonly string[] | ParseInput;
export type GenerateCodeInput = GenerateInput | ParseOutput | CurlIr;

export interface GenerateCodeOptions {{
  target?: Target;
  options?: GenerateInputOptions;
}}

export interface CurlParser {{
  parseCurl(input: ParseCurlInput, options?: ParseCurlOptions): Promise<ParseOutput>;
  generateCode(input: GenerateCodeInput, options?: GenerateCodeOptions): Promise<GenerateOutput>;
  listTargets(): readonly Target[];
  dispose(): void;
}}

export interface WasmCreateOptions {{
  wasmBytes?: BufferSource;
  wasmModule?: WebAssembly.Module;
  imports?: WebAssembly.Imports;
  onInstantiate?: (instance: WebAssembly.Instance) => void;
}}

export interface NodeCreateParserOptions extends ParseCurlOptions {{
  wasmPath?: string | URL;
  wasmBytes?: BufferSource;
}}

export interface BrowserCreateParserOptions extends WasmCreateOptions, ParseCurlOptions {{}}
""", target_enum


def render_capabilities(target_enum: list[str]) -> str:
    manifests: dict[str, Any] = {}
    for target in target_enum:
        path = CAPABILITY_DIR / f"{target}.json"
        if not path.is_file():
            raise SystemExit(f"missing capability manifest: {path.relative_to(REPO_ROOT)}")
        payload = load_json(path)
        if not isinstance(payload, dict):
            raise SystemExit(f"{path.relative_to(REPO_ROOT)} must be an object")
        if payload.get("schemaVersion") != "curl-target-capabilities/v2":
            raise SystemExit(f"{path.relative_to(REPO_ROOT)} schemaVersion must be curl-target-capabilities/v2")
        if payload.get("target") != target:
            raise SystemExit(f"{path.relative_to(REPO_ROOT)} target must be {target}")
        manifests[target] = payload

    payload = json.dumps(manifests, indent=2)
    return f"""// Generated by scripts/build/generate_ts_types.py. Do not edit by hand.

import type {{ CapabilityLevel, Target }} from "./types.js";

export interface TargetLibraryCapability {{
  name: string;
  ecosystem: "c" | "python" | "javascript" | "go" | "rust";
  minimumVersion?: string;
  notes?: string;
}}

export interface TargetBehaviorCapability {{
  id: string;
  capability: CapabilityLevel;
  message: string;
  notes?: string;
  requiredDependency?: string;
  requiredRuntime?: string;
  requiredFeature?: string;
  unsafeWhen?: string;
}}

export interface TargetCapabilityManifest {{
  schemaVersion: "curl-target-capabilities/v2";
  target: Target;
  library: TargetLibraryCapability;
  behaviors: Record<string, TargetBehaviorCapability>;
}}

export const TARGET_CAPABILITY_MANIFESTS = {payload} as const satisfies Record<Target, TargetCapabilityManifest>;
"""


def write_or_check(path: Path, content: str, *, check: bool) -> None:
    if check:
        current = path.read_text(encoding="utf-8") if path.is_file() else ""
        if current != content:
            raise SystemExit(
                f"{path.relative_to(REPO_ROOT)} is stale; "
                "run nix develop --command python scripts/tasks.py generate"
            )
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail if generated outputs are stale")
    args = parser.parse_args()

    schemas = load_schemas()
    types_content, target_enum = render_types(schemas)
    capabilities_content = render_capabilities(target_enum)

    write_or_check(OUTPUT, types_content, check=args.check)
    write_or_check(CAPABILITIES_OUTPUT, capabilities_content, check=args.check)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
