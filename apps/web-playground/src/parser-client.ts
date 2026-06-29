import {
  createBrowserWasiImports,
  createParser,
  listTargets,
  parseShellCommand,
  supportedShellDialects,
} from "@hellodword/curl-parser/browser";
import type {
  CurlParser,
  GenerateOutput,
  ParseCurlOptions,
  ShellDialect,
  Target,
} from "@hellodword/curl-parser/browser";
import type { SelectOption } from "naive-ui";

import wasmUrl from "../../../dist/curl_parser.wasm?url";

import type { PlaygroundResult, ShellParseResult } from "./types";

export const defaultCommand =
  "curl --json '{\"name\":\"demo\"}' https://api.example.com/widgets";

let parserPromise: Promise<CurlParser> | null = null;

async function getParser(): Promise<CurlParser> {
  if (!parserPromise) {
    const wasi = createBrowserWasiImports();
    parserPromise = fetch(wasmUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`wasm fetch failed: ${response.status}`);
        }
        return response.arrayBuffer();
      })
      .then((wasmBytes) =>
        createParser({
          wasmBytes,
          imports: wasi.imports,
          onInstantiate: wasi.setInstance,
        }),
      );
  }
  return parserPromise;
}

export function targetOptions(): SelectOption[] {
  return listTargets().map((target) => ({
    label: target,
    value: target,
  }));
}

export function shellOptions(): SelectOption[] {
  return supportedShellDialects.map((shell) => ({
    label: shell,
    value: shell,
  }));
}

export function parseCommand(command: string, shellDialect: ShellDialect): ShellParseResult {
  return parseShellCommand(command.trim(), {
    shellDialect,
    parseMode: "diagnostic",
  });
}

export async function parseAndGenerate(
  command: string,
  shellDialect: ShellDialect,
  target: Target,
): Promise<PlaygroundResult> {
  const parser = await getParser();
  const shellResult = parseCommand(command, shellDialect);
  const parseResult = await parser.parseCurl(shellResult.input);
  let generateResult: GenerateOutput | null = null;

  if (parseResult.ok && parseResult.ir) {
    generateResult = await parser.generateCode(parseResult, { target });
  }

  return {
    shellResult,
    parseResult,
    generateResult,
  };
}
