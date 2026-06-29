import { applyGoNetHttpGenerator } from "./go_net_http.js";
import {
  renderUnsupportedUrlSchemeFiles,
  withUnsupportedExternalRefDiagnostic,
  withUnsupportedUrlSchemeDiagnostic,
} from "./generator_fail_fast.js";
import { applyJavaScriptGenerator } from "./javascript_generators.js";
import { renderLibcurlFiles } from "./libcurl_c.js";
import { applyPythonRequestsGenerator } from "./python_requests.js";
import { applyRustReqwestGenerator } from "./rust_reqwest.js";
import type { GenerateInput, GenerateOutput } from "./types.js";

export function applyCodeGenerators(input: GenerateInput, output: GenerateOutput): GenerateOutput {
  const plannedOutput = withUnsupportedExternalRefDiagnostic(
    input,
    withUnsupportedUrlSchemeDiagnostic(input, output),
  );
  const unsupportedUrlSchemeFiles = renderUnsupportedUrlSchemeFiles(input.target, plannedOutput);
  if (unsupportedUrlSchemeFiles) {
    return {
      ...plannedOutput,
      files: unsupportedUrlSchemeFiles,
    };
  }

  if (input.target === "c.libcurl") {
    return {
      ...plannedOutput,
      files: renderLibcurlFiles(input),
    };
  }
  if (input.target === "python.requests") {
    return applyPythonRequestsGenerator(input, plannedOutput);
  }
  if (input.target === "js.fetch" || input.target === "js.undici") {
    return applyJavaScriptGenerator(input, plannedOutput);
  }
  if (input.target === "go.net_http") {
    return applyGoNetHttpGenerator(input, plannedOutput);
  }
  if (input.target === "rust.reqwest") {
    return applyRustReqwestGenerator(input, plannedOutput);
  }
  return plannedOutput;
}
