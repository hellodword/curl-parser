import type { Diagnostic, GenerateInput, GenerateOutput, GeneratedFile, Target } from "./types.js";

const HTTP_URL_PATTERN = /^https?:\/\//i;
const UNSUPPORTED_URL_SCHEME_MESSAGE = "Target does not support this URL scheme.";
const BROWSER_EXTERNAL_REF_MESSAGE = "Browser fetch cannot access local external references.";
const BROWSER_UNSUPPORTED_EXTERNAL_REF_KINDS = new Set([
  "file",
  "stdin",
  "directory",
  "output-file",
  "cookie-jar",
  "netrc",
  "unix-socket",
  "local-file-url",
]);

function targetIsHttpOnly(target: Target): boolean {
  return target !== "c.libcurl";
}

function hasUnsupportedTransferUrl(input: GenerateInput): boolean {
  if (!targetIsHttpOnly(input.target)) {
    return false;
  }
  return input.ir.groups.some((group) =>
    group.transfers.some((transfer) => !HTTP_URL_PATTERN.test(transfer.url)),
  );
}

function makeUnsupportedUrlSchemeDiagnostic(target: Target): Diagnostic {
  return {
    code: "E_TARGET_URL_SCHEME_UNSUPPORTED",
    severity: "error",
    category: "target",
    message: UNSUPPORTED_URL_SCHEME_MESSAGE,
    details: {
      target,
      behavior: "url.scheme",
    },
  };
}

function hasUnsupportedBrowserExternalRef(input: GenerateInput): boolean {
  return input.target === "js.fetch" && input.ir.externalRefs.some((ref) =>
    BROWSER_UNSUPPORTED_EXTERNAL_REF_KINDS.has(ref.kind),
  );
}

function makeBrowserExternalRefDiagnostic(): Diagnostic {
  return {
    code: "E_TARGET_EXTERNAL_REF_UNSUPPORTED",
    severity: "error",
    category: "target",
    message: BROWSER_EXTERNAL_REF_MESSAGE,
    details: {
      target: "js.fetch",
      behavior: "external-ref",
    },
  };
}

export function withUnsupportedUrlSchemeDiagnostic(
  input: GenerateInput,
  output: GenerateOutput,
): GenerateOutput {
  if (!hasUnsupportedTransferUrl(input)) {
    return output;
  }
  if (unsupportedUrlSchemeDiagnostic(output)) {
    return output;
  }

  return {
    ...output,
    plan: {
      ...output.plan,
      transfers: output.plan.transfers.map((transfer) => ({
        ...transfer,
        steps: transfer.steps.map((step) =>
          step.behavior === "url"
            ? {
                behavior: "url.scheme",
                capability: "unsupported",
                message: UNSUPPORTED_URL_SCHEME_MESSAGE,
              }
            : step,
        ),
      })),
    },
    support: {
      level: "unsupported",
      items: [
        ...output.support.items,
        {
          behavior: "url.scheme",
          level: "unsupported",
          message: UNSUPPORTED_URL_SCHEME_MESSAGE,
        },
      ],
    },
    diagnostics: [makeUnsupportedUrlSchemeDiagnostic(input.target), ...output.diagnostics],
  };
}

export function withUnsupportedExternalRefDiagnostic(
  input: GenerateInput,
  output: GenerateOutput,
): GenerateOutput {
  if (!hasUnsupportedBrowserExternalRef(input)) {
    return output;
  }
  if (output.diagnostics.some((diagnostic) => diagnostic.code === "E_TARGET_EXTERNAL_REF_UNSUPPORTED")) {
    return output;
  }

  return {
    ...output,
    plan: {
      ...output.plan,
      transfers: output.plan.transfers.map((transfer) => ({
        ...transfer,
        steps: [
          ...transfer.steps,
          {
            behavior: "external-ref",
            capability: "unsupported",
            message: BROWSER_EXTERNAL_REF_MESSAGE,
          },
        ],
      })),
    },
    support: {
      level: "unsupported",
      items: [
        ...output.support.items,
        {
          behavior: "external-ref",
          level: "unsupported",
          message: BROWSER_EXTERNAL_REF_MESSAGE,
        },
      ],
    },
    diagnostics: [makeBrowserExternalRefDiagnostic(), ...output.diagnostics],
  };
}

function unsupportedUrlSchemeDiagnostic(output: GenerateOutput): Diagnostic | undefined {
  return output.diagnostics.find((diagnostic) => diagnostic.code === "E_TARGET_URL_SCHEME_UNSUPPORTED");
}

function unsupportedExternalRefDiagnostic(output: GenerateOutput): Diagnostic | undefined {
  return output.diagnostics.find((diagnostic) => diagnostic.code === "E_TARGET_EXTERNAL_REF_UNSUPPORTED");
}

function failMessage(target: Target, diagnostic: Diagnostic): string {
  return diagnostic.message || `Target ${target} does not support this URL scheme.`;
}

function jsFile(target: Target, message: string): GeneratedFile {
  return {
    path: target === "js.undici" ? "main.mjs" : "main.js",
    role: "main",
    content: `throw new Error(${JSON.stringify(message)});\n`,
  };
}

function pythonFile(message: string): GeneratedFile {
  return {
    path: "main.py",
    role: "main",
    content: `raise SystemExit(${JSON.stringify(message)})\n`,
  };
}

function goFile(message: string): GeneratedFile {
  return {
    path: "main.go",
    role: "main",
    content: [
      "package main",
      "",
      "import (",
      '    "fmt"',
      '    "os"',
      ")",
      "",
      "func main() {",
      `    fmt.Fprintln(os.Stderr, ${JSON.stringify(message)})`,
      "    os.Exit(1)",
      "}",
      "",
    ].join("\n"),
  };
}

function rustFiles(message: string): GeneratedFile[] {
  const main = [
    "fn main() {",
    `    eprintln!("{}", ${JSON.stringify(message)});`,
    "    std::process::exit(1);",
    "}",
    "",
  ].join("\n");
  return [
    {
      path: "Cargo.toml",
      role: "manifest",
      content: [
        "[package]",
        'name = "generated-curl-request"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
    },
    {
      path: "src/main.rs",
      role: "main",
      content: main,
    },
    {
      path: "src/async_main.rs",
      role: "main",
      content: main,
    },
  ];
}

function cFile(message: string): GeneratedFile {
  return {
    path: "main.c",
    role: "main",
    content: [
      "#include <stdio.h>",
      "",
      "int main(void)",
      "{",
      `  fputs(${JSON.stringify(`${message}\n`)}, stderr);`,
      "  return 1;",
      "}",
      "",
    ].join("\n"),
  };
}

export function renderUnsupportedUrlSchemeFiles(
  target: Target,
  output: GenerateOutput,
): GeneratedFile[] | undefined {
  const diagnostic = unsupportedUrlSchemeDiagnostic(output);
  const externalRefDiagnostic = unsupportedExternalRefDiagnostic(output);
  if (!diagnostic && !externalRefDiagnostic) {
    return undefined;
  }

  const message = externalRefDiagnostic
    ? (externalRefDiagnostic.message || BROWSER_EXTERNAL_REF_MESSAGE)
    : failMessage(target, diagnostic!);
  if (target === "js.fetch" || target === "js.undici") {
    return [jsFile(target, message)];
  }
  if (target === "python.requests") {
    return [pythonFile(message)];
  }
  if (target === "go.net_http") {
    return [goFile(message)];
  }
  if (target === "rust.reqwest") {
    return rustFiles(message);
  }
  if (target === "c.libcurl") {
    return [cFile(message)];
  }
  return undefined;
}
