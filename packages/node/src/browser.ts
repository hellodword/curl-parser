import { createParserFromWasm } from "./parser.js";
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
  options: BrowserCreateParserOptions & GenerateCodeOptions,
): Promise<GenerateOutput> {
  const parser = await createParser(options);
  try {
    return await parser.generateCode(input, options);
  } finally {
    parser.dispose();
  }
}

export {
  createParseInputFromArgv,
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
  CurlIr,
  CurlIrTransfer,
  CurlIrTransferGroup,
  CurlIrUrlResolution,
  CurlParser,
  Diagnostic,
  GenerateCodeInput,
  GenerateCodeOptions,
  GenerateInput,
  GenerateOutput,
  ParseCurlInput,
  ParseCurlOptions,
  ParseInput,
  ParseOutput,
  ShellDialect,
  SourceSpan,
  Target,
} from "./types.js";
