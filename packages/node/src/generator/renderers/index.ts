import { applyGoNetHttpGenerator } from "../../go_net_http.js";
import { applyJavaScriptGenerator } from "../../javascript_generators.js";
import { applyPythonRequestsGenerator } from "../../python_requests.js";
import { applyRustReqwestGenerator } from "../../rust_reqwest.js";
import type { GenerateInput, GenerateOutput } from "../../types.js";
import { renderUnsupportedFiles } from "./unsupported.js";

export function renderTarget(input: GenerateInput, plannedOutput: GenerateOutput): GenerateOutput {
  const unsupportedFiles = renderUnsupportedFiles(input.target, plannedOutput);
  if (unsupportedFiles) {
    return {
      ...plannedOutput,
      files: unsupportedFiles,
    };
  }

  if (input.target === "python.requests" || input.target === "python.httpx") {
    return applyPythonRequestsGenerator(input, plannedOutput);
  }
  if (input.target === "js.fetch" || input.target === "js.undici" || input.target === "js.axios") {
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
