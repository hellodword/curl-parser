import type { Diagnostic, GenerateOutput, GeneratedFile, Target } from "../../types.js";

const URL_SCHEME_MESSAGE = "Target does not support this URL scheme.";
const EXTERNAL_REF_MESSAGE = "Browser fetch cannot access local external references.";

function unsupportedDiagnostic(output: GenerateOutput): Diagnostic | undefined {
  return output.diagnostics.find((diagnostic) =>
    diagnostic.code === "E_TARGET_URL_SCHEME_UNSUPPORTED" ||
    diagnostic.code === "E_TARGET_EXTERNAL_REF_UNSUPPORTED",
  ) ?? output.diagnostics.find((diagnostic) =>
    diagnostic.severity === "error" && diagnostic.category === "target",
  );
}

function jsFile(target: Target, message: string): GeneratedFile {
  return {
    path: target === "js.undici" || target === "js.axios" ? "main.mjs" : "main.js",
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

export function renderUnsupportedFiles(
  target: Target,
  output: GenerateOutput,
): GeneratedFile[] | undefined {
  const diagnostic = unsupportedDiagnostic(output);
  if (!diagnostic) {
    return undefined;
  }

  const message = diagnostic.message ||
    (diagnostic.code === "E_TARGET_EXTERNAL_REF_UNSUPPORTED"
      ? EXTERNAL_REF_MESSAGE
      : URL_SCHEME_MESSAGE);
  if (target === "js.fetch" || target === "js.undici" || target === "js.axios") {
    return [jsFile(target, message)];
  }
  if (target === "python.requests" || target === "python.httpx") {
    return [pythonFile(message)];
  }
  if (target === "go.net_http") {
    return [goFile(message)];
  }
  if (target === "rust.reqwest") {
    return rustFiles(message);
  }
  return undefined;
}
