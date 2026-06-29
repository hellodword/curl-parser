import type {
  Diagnostic,
  GenerateOutput,
  ParseOutput,
  ShellDialect,
  SourceSpan,
  Target,
} from "@hellodword/curl-parser/browser";
import { parseShellCommand } from "@hellodword/curl-parser/browser";

export type {
  Diagnostic,
  GenerateOutput,
  ParseOutput,
  ShellDialect,
  SourceSpan,
  Target,
} from "@hellodword/curl-parser/browser";

export type GeneratedFile = GenerateOutput["files"][number];
export type ShellParseResult = ReturnType<typeof parseShellCommand>;

export type PlaygroundStatus = "Enter a curl command" | "Parsing" | "Ready" | "Parse failed" | "Error";

export interface PlaygroundResult {
  shellResult: ShellParseResult;
  parseResult: ParseOutput;
  generateResult: GenerateOutput | null;
}

export interface ExternalRef {
  id?: string;
  kind?: string;
  access?: string;
  option?: string | null;
  value?: string | null;
  source?: SourceSpan;
}

export interface CommandExplanation {
  id: string;
  argvIndex: number;
  eventIndex?: number;
  token: string;
  displayToken: string;
  sourceToken?: string;
  shortFlag?: string;
  title: string;
  description: string;
  canonical?: string;
  span?: SourceSpan;
  externalRefs?: ExternalRef[];
  severity: "default" | "warning" | "error";
}

export type ParserShellDialect = ShellDialect;
export type ParserTarget = Target;
