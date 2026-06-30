import { createParserFromWasm, generateCodeFromIr } from "./parser.js";
import type {
  BrowserCreateParserOptions,
  CurlParser,
  GenerateCodeInput,
  GenerateCodeOptions,
  GenerateOutput,
  ParseCurlInput,
  ParseOutput,
} from "./types.js";
import { CurlParserWasm } from "./wasm.js";

export async function createParser(options: BrowserCreateParserOptions): Promise<CurlParser> {
  if (!options.wasmBytes && !options.wasmModule) {
    throw new TypeError("browser createParser requires wasmBytes or wasmModule");
  }
  const source = options.wasmModule ?? options.wasmBytes;
  if (!source) {
    throw new TypeError("browser createParser requires wasmBytes or wasmModule");
  }
  const wasm = await CurlParserWasm.instantiate(source, options.imports ?? {}, options.onInstantiate);
  return createParserFromWasm(wasm);
}

export async function parseCurl(
  input: ParseCurlInput,
  options: BrowserCreateParserOptions,
): Promise<ParseOutput> {
  const parser = await createParser(options);
  try {
    return await parser.parseCurl(input, options);
  } finally {
    parser.dispose();
  }
}

export async function generateCode(
  input: GenerateCodeInput,
  options: GenerateCodeOptions = {},
): Promise<GenerateOutput> {
  return generateCodeFromIr(input, options);
}

export {
  createParseInputFromArgv,
  generateCodeFromIr,
  listSchemaExports,
  listTargets,
  parseShellCommand,
  schemaCatalog,
  supportedShellDialects,
} from "./parser.js";
export { createBrowserWasiImports } from "./browser_wasi.js";
export { CurlParserError, CurlParserWasm } from "./wasm.js";
export type {
  BrowserCreateParserOptions,
  CapabilityLevel,
  CurlIr,
  CurlIrTransfer,
  CurlIrTransferGroup,
  CurlIrUrlResolution,
  CurlParser,
  Diagnostic,
  DiagnosticSeverity,
  ExternalRef,
  ExternalRefKind,
  GeneratedFile,
  GenerateCodeInput,
  GenerateCodeOptions,
  GenerateInput,
  GenerateInputOptions,
  GenerateOutput,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  NodeCreateParserOptions,
  ParseCurlInput,
  ParseCurlOptions,
  ParseInput,
  ParseOutput,
  RequestPlan,
  ShellDialect,
  SourceSpan,
  SupportItem,
  SupportItemLevel,
  SupportLevel,
  SupportReport,
  Target,
  WasmCreateOptions,
} from "./types.js";
