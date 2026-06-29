export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type ShellDialect = "bash" | "zsh" | "posix-sh" | "powershell" | "cmd" | "fish";
export type DiagnosticSeverity = "error" | "warning" | "info";
export type Target =
  | "c.libcurl"
  | "python.requests"
  | "js.fetch"
  | "js.undici"
  | "go.net_http"
  | "rust.reqwest";

export interface SourceSpan {
  source: string;
  argvIndex?: number;
  start?: number;
  end?: number;
}

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  category?: string;
  message?: string;
  source?: SourceSpan;
  [key: string]: unknown;
}

export interface ParseInput {
  schemaVersion: "curl-parse-input/v1";
  inputMode: "argv" | "shell";
  argv?: string[];
  argvSpans?: SourceSpan[];
  command?: string;
  shellDialect?: ShellDialect;
  parseMode?: "strict" | "diagnostic";
  runtimeProfile?: unknown;
}

export interface ShellParseResult {
  input: ParseInput;
  diagnostics: Diagnostic[];
  shellDialect: ShellDialect;
}

export interface CurlIrUrlResolution {
  scheme: string;
  source: "curl-default" | "hostname-prefix" | "proto-default";
  normalized: string;
}

export interface CurlIrTransfer {
  id: string;
  index: number;
  url: string;
  rawUrl?: string;
  urlResolution?: CurlIrUrlResolution;
  effective: Record<string, unknown>;
  source?: SourceSpan;
  [key: string]: unknown;
}

export interface CurlIrTransferGroup {
  id: string;
  index: number;
  options: Record<string, unknown>;
  transfers: CurlIrTransfer[];
  source?: SourceSpan;
  [key: string]: unknown;
}

export interface CurlIr {
  schemaVersion: "curl-ir/v1";
  curlSourceVersion: string;
  command: Record<string, unknown>;
  externalRefs: ExternalRef[];
  runtime: Record<string, unknown>;
  globals: Record<string, unknown>;
  groups: CurlIrTransferGroup[];
  diagnostics: Diagnostic[];
}

export interface ExternalRef {
  id: string;
  kind: string;
  access: string;
  option?: string | null;
  value?: string | null;
  source?: SourceSpan | null;
}

export interface SupportItem {
  behavior?: string;
  level?: string;
  message?: string;
  [key: string]: unknown;
}

export interface SupportReport {
  level: "exact" | "lossy" | "requires-runtime-helper" | "unsupported" | string;
  items: SupportItem[];
}

export interface ParseOutput {
  ok: boolean;
  schemaVersion: "curl-parse-output/v1";
  curlSourceVersion?: string;
  runtimeProfileApplied?: unknown;
  ir?: CurlIr;
  argv?: string[];
  operations?: unknown[];
  events?: unknown[];
  diagnostics: Diagnostic[];
  errors: Diagnostic[];
  [key: string]: unknown;
}

export interface GenerateInputOptions {
  secretMode?: "redact" | "env-ref" | "preserve";
  runtimeHelpers?: "allow" | "inline" | "forbid";
  format?: boolean;
}

export interface GenerateInput {
  schemaVersion: "curl-generate-input/v1";
  target: Target;
  ir: CurlIr;
  options?: GenerateInputOptions;
}

export interface GeneratedFile {
  path: string;
  content: string;
  role?: "main" | "helper" | "manifest" | "test" | "documentation";
}

export interface RequestPlan {
  target: Target;
  transfers: Array<{
    id: string;
    steps: Array<{
      behavior: string;
      capability:
        | "native"
        | "lossy"
        | "requires-runtime-helper"
        | "unsupported";
      message?: string;
    }>;
  }>;
}

export interface GenerateOutput {
  schemaVersion: "curl-generate-output/v1";
  target: Target;
  files: GeneratedFile[];
  plan: RequestPlan;
  support: SupportReport;
  diagnostics: Diagnostic[];
}

export interface ParseCurlOptions {
  shellDialect?: ShellDialect;
  parseMode?: ParseInput["parseMode"];
  runtimeProfile?: unknown;
}

export type ParseCurlInput = string | readonly string[] | ParseInput;
export type GenerateCodeInput = GenerateInput | ParseOutput | CurlIr;

export interface GenerateCodeOptions {
  target?: Target;
  options?: GenerateInputOptions;
}

export interface CurlParser {
  parseCurl(input: ParseCurlInput, options?: ParseCurlOptions): Promise<ParseOutput>;
  generateCode(input: GenerateCodeInput, options?: GenerateCodeOptions): Promise<GenerateOutput>;
  listTargets(): readonly Target[];
  dispose(): void;
}

export interface WasmCreateOptions {
  wasmBytes?: BufferSource;
  wasmModule?: WebAssembly.Module;
  imports?: WebAssembly.Imports;
  onInstantiate?: (instance: WebAssembly.Instance) => void;
}

export interface NodeCreateParserOptions extends ParseCurlOptions {
  wasmPath?: string | URL;
  wasmBytes?: BufferSource;
}

export interface BrowserCreateParserOptions extends WasmCreateOptions, ParseCurlOptions {}
