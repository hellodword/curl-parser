import { renderTarget } from "./renderers/index.js";
import { planSupport } from "./support_planner.js";
import type { GenerateInput, GenerateOutput } from "../types.js";

export { normalizeGenerateInput } from "./normalize.js";

export function generateFromIr(input: GenerateInput): GenerateOutput {
  return renderTarget(input, planSupport(input));
}
