#!/usr/bin/env node
import { generateCode, listSchemaExports, listTargets, parseCurl, schemaCatalog } from "./node.js";
import type {
  GenerateCodeOptions,
  GenerateOutput,
  ParseCurlOptions,
  Target,
} from "./types.js";

function usage(): string {
  return [
    "curl-parser commands: parse, generate, plan, targets, explain, schema",
    "parse [--json] [--shell DIALECT] -- <curl command...>",
    "generate --target TARGET [--json] [--fail-on-warning] -- <curl command...>",
    "generate --target TARGET [--json] [--fail-on-warning] < parse-output.json",
    "plan --target TARGET -- <curl command...>",
    "explain --target TARGET -- <curl command...>",
    "targets",
    "schema",
  ].join("\n");
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
  });
}

function splitArgs(argv: string[]): { flags: Record<string, string>; rest: string[] } {
  const flags: Record<string, string> = {};
  const rest: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--") {
      rest.push(...argv.slice(index + 1));
      break;
    }
    if (item.startsWith("--")) {
      const name = item.slice(2);
      const value = argv[index + 1];
      if (value && !value.startsWith("--")) {
        flags[name] = value;
        index += 1;
      } else {
        flags[name] = "true";
      }
      continue;
    }
    rest.push(item);
  }
  return { flags, rest };
}

async function parseOptions(flags: Record<string, string>): Promise<ParseCurlOptions> {
  return {
    ...(flags.shell ? { shellDialect: flags.shell as ParseCurlOptions["shellDialect"] } : {}),
  };
}

function hasWarning(output: { diagnostics?: Array<{ severity?: string }> }): boolean {
  return (output.diagnostics ?? []).some((item) => item.severity === "warning");
}

function renderGeneratedCode(result: GenerateOutput): string {
  if (result.files.length === 1) {
    return result.files[0].content;
  }
  return JSON.stringify(
    Object.fromEntries(result.files.map((file) => [file.path, file.content])),
    null,
    2,
  );
}

async function generateInputFromCli(
  parsed: { flags: Record<string, string>; rest: string[] },
): Promise<Parameters<typeof generateCode>[0]> {
  if (parsed.rest.length > 0) {
    return parseCurl(parsed.rest.join(" "), await parseOptions(parsed.flags));
  }
  return JSON.parse(await readStdin()) as Parameters<typeof generateCode>[0];
}

function targetFromFlags(flags: Record<string, string>): Target {
  return (flags.target ?? "js.fetch") as Target;
}

async function main(argv = process.argv.slice(2)): Promise<number> {
  const [command, ...args] = argv;
  const parsed = splitArgs(args);

  if (!command) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  if (command === "targets") {
    const generatorTargets = new Set([
      "python.requests",
      "python.httpx",
      "js.fetch",
      "js.undici",
      "js.axios",
      "go.net_http",
      "rust.reqwest",
    ]);
    const summary = listTargets().map((target) => ({
      target,
      generator: generatorTargets.has(target),
      capabilitySchema: "curl-target-capabilities/v2",
    }));
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return 0;
  }

  if (command === "schema") {
    process.stdout.write(
      `${JSON.stringify({ schemas: listSchemaExports(), catalog: schemaCatalog }, null, 2)}\n`,
    );
    return 0;
  }

  if (command === "parse") {
    const options = await parseOptions(parsed.flags);
    const input = parsed.rest.length > 0 ? parsed.rest.join(" ") : await readStdin();
    const result = await parseCurl(input.trim(), options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) {
      return 1;
    }
    return parsed.flags["fail-on-warning"] === "true" && hasWarning(result) ? 1 : 0;
  }

  if (command === "generate") {
    const target = targetFromFlags(parsed.flags);
    const options: GenerateCodeOptions = { target };
    const input = await generateInputFromCli(parsed);
    const result = await generateCode(input, options);
    process.stdout.write(
      parsed.flags.json === "true"
        ? `${JSON.stringify(result, null, 2)}\n`
        : `${renderGeneratedCode(result)}\n`,
    );
    return parsed.flags["fail-on-warning"] === "true" && hasWarning(result) ? 1 : 0;
  }

  if (command === "plan") {
    const target = targetFromFlags(parsed.flags);
    const result = await generateCode(await generateInputFromCli(parsed), { target });
    process.stdout.write(`${JSON.stringify(result.plan, null, 2)}\n`);
    return parsed.flags["fail-on-warning"] === "true" && hasWarning(result) ? 1 : 0;
  }

  if (command === "explain") {
    const target = targetFromFlags(parsed.flags);
    const result = await generateCode(await generateInputFromCli(parsed), { target });
    process.stdout.write(
      `${JSON.stringify(
        {
          target: result.target,
          support: result.support,
          diagnostics: result.diagnostics,
        },
        null,
        2,
      )}\n`,
    );
    return parsed.flags["fail-on-warning"] === "true" && hasWarning(result) ? 1 : 0;
  }

  process.stderr.write(`${usage()}\n`);
  return 2;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
