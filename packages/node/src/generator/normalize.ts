import type {
  CurlIr,
  GenerateCodeInput,
  GenerateCodeOptions,
  GenerateInput,
  ParseOutput,
  Target,
} from "../types.js";

function isParseOutput(value: unknown): value is ParseOutput {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { schemaVersion?: unknown }).schemaVersion === "curl-parse-output/v2",
  );
}

function isCurlIr(value: unknown): value is CurlIr {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { schemaVersion?: unknown }).schemaVersion === "curl-ir/v2",
  );
}

function isGenerateInput(value: unknown): value is GenerateInput {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { schemaVersion?: unknown }).schemaVersion === "curl-generate-input/v2",
  );
}

export function normalizeGenerateInput(
  input: GenerateCodeInput,
  options: GenerateCodeOptions = {},
): GenerateInput {
  const target: Target = options.target ?? "js.fetch";

  if (isGenerateInput(input)) {
    return input;
  }

  if (isParseOutput(input)) {
    if (!input.ir) {
      throw new TypeError("ParseOutput does not contain ir");
    }
    return {
      schemaVersion: "curl-generate-input/v2",
      target,
      ir: input.ir,
      ...(options.options ? { options: options.options } : {}),
    };
  }

  if (isCurlIr(input)) {
    return {
      schemaVersion: "curl-generate-input/v2",
      target,
      ir: input,
      ...(options.options ? { options: options.options } : {}),
    };
  }

  throw new TypeError("generateCode input must be GenerateInput, ParseOutput, or CurlIr");
}
