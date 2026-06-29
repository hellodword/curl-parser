import { readFile } from "node:fs/promises";
import { WASI } from "node:wasi";

import { createParserFromWasm } from "./parser.js";
import type {
  CurlParser,
  GenerateCodeInput,
  GenerateCodeOptions,
  GenerateOutput,
  NodeCreateParserOptions,
  ParseCurlInput,
  ParseOutput,
} from "./types.js";
import { CurlParserWasm } from "./wasm.js";

const defaultWasmPath = new URL("../wasm/curl_parser.wasm", import.meta.url);

export async function createParser(options: NodeCreateParserOptions = {}): Promise<CurlParser> {
  const wasmBytes = options.wasmBytes ?? (await readFile(options.wasmPath ?? defaultWasmPath));
  const wasi = new WASI({
    version: "preview1",
    args: [],
    env: {},
    preopens: {},
  });
  const wasm = await CurlParserWasm.instantiate(wasmBytes, wasi.getImportObject());

  wasi.initialize(wasm.instance);
  return createParserFromWasm(wasm);
}

export async function parseCurl(
  input: ParseCurlInput,
  options: NodeCreateParserOptions = {},
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
  options: NodeCreateParserOptions & GenerateCodeOptions = {},
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
  NodeCreateParserOptions,
  ParseCurlInput,
  ParseCurlOptions,
  ParseInput,
  ParseOutput,
  ShellDialect,
  SourceSpan,
  Target,
} from "./types.js";
