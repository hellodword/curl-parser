import { listTargets } from "./schemas.js";
import { generateFromIr, normalizeGenerateInput } from "./generator/index.js";
import { createParseInputFromArgv, parseShellCommand } from "./shell.js";
import type {
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
  Target,
} from "./types.js";
import { CurlParserWasm } from "./wasm.js";

function isParseInput(value: unknown): value is ParseInput {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { schemaVersion?: unknown }).schemaVersion === "curl-parse-input/v2",
  );
}

function normalizeParseInput(
  input: ParseCurlInput,
  options: ParseCurlOptions = {},
): { input: ParseInput; diagnostics: Diagnostic[] } {
  if (typeof input === "string") {
    const shell = parseShellCommand(input, options);
    return {
      input: shell.input,
      diagnostics: shell.diagnostics,
    };
  }

  if (Array.isArray(input)) {
    return {
      input: createParseInputFromArgv(input, options),
      diagnostics: [],
    };
  }

  if (isParseInput(input)) {
    if (input.inputMode === "shell") {
      if (typeof input.command !== "string" || input.command.length === 0) {
        throw new TypeError("shell ParseInput must include a non-empty command");
      }
      const shell = parseShellCommand(input.command, {
        ...options,
        ...(input.shellDialect ? { shellDialect: input.shellDialect } : {}),
        ...(input.parseMode ? { parseMode: input.parseMode } : {}),
        ...(input.runtimeProfile ? { runtimeProfile: input.runtimeProfile } : {}),
      });
      return {
        input: shell.input,
        diagnostics: shell.diagnostics,
      };
    }
    return {
      input: { ...input },
      diagnostics: [],
    };
  }

  throw new TypeError("parseCurl input must be a command string, argv array, or ParseInput");
}

function withShellDiagnostics(output: ParseOutput, diagnostics: Diagnostic[]): ParseOutput {
  if (diagnostics.length === 0) {
    return output;
  }
  const errors = diagnostics.filter((item) => item.severity === "error");
  return {
    ...output,
    diagnostics: [...diagnostics, ...(output.diagnostics ?? [])],
    errors: [...errors, ...(output.errors ?? [])],
  };
}

class CurlParserHandle implements CurlParser {
  constructor(private readonly wasm: CurlParserWasm) {}

  async parseCurl(input: ParseCurlInput, options: ParseCurlOptions = {}): Promise<ParseOutput> {
    const normalized = normalizeParseInput(input, options);
    const parsed = this.wasm.parse(normalized.input);
    return withShellDiagnostics(parsed, normalized.diagnostics);
  }

  async generateCode(
    input: GenerateCodeInput,
    options: GenerateCodeOptions = {},
  ): Promise<GenerateOutput> {
    return generateCodeFromIr(input, options);
  }

  listTargets(): readonly Target[] {
    return listTargets();
  }

  dispose(): void {
    this.wasm.dispose();
  }
}

export function createParserFromWasm(wasm: CurlParserWasm): CurlParser {
  return new CurlParserHandle(wasm);
}

export function generateCodeFromIr(input: GenerateInput): GenerateOutput;
export function generateCodeFromIr(
  input: GenerateCodeInput,
  options?: GenerateCodeOptions,
): GenerateOutput;
export function generateCodeFromIr(
  input: GenerateCodeInput,
  options: GenerateCodeOptions = {},
): GenerateOutput {
  return generateFromIr(normalizeGenerateInput(input, options));
}

export { createParseInputFromArgv, parseShellCommand, supportedShellDialects } from "./shell.js";
export { listSchemaExports, listTargets, schemaCatalog } from "./schemas.js";
