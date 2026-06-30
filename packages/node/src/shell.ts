import type {
  Diagnostic,
  ParseInput,
  ParseCurlOptions,
  ShellDialect,
  ShellParseResult,
  SourceSpan,
} from "./types.js";

const POSIX_DIALECTS = new Set<ShellDialect>(["bash", "zsh", "posix-sh", "fish"]);
const SUPPORTED_DIALECTS = new Set<ShellDialect>([
  ...POSIX_DIALECTS,
  "powershell",
  "cmd",
]);

interface Scanner {
  command: string;
  shellDialect: ShellDialect;
  argv: string[];
  argvSpans: SourceSpan[];
  diagnostics: Diagnostic[];
  token: string;
  tokenStart: number | null;
  tokenEnd: number | null;
}

function sourceSpan(start: number, end: number): SourceSpan {
  return {
    source: "command",
    start,
    end,
  };
}

function diagnostic(
  code: string,
  severity: "error" | "warning",
  message: string,
  start: number,
  end: number,
): Diagnostic {
  return {
    code,
    severity,
    category: "shell",
    message,
    source: sourceSpan(start, end),
  };
}

function createScanner(command: string, shellDialect: ShellDialect): Scanner {
  return {
    command,
    shellDialect,
    argv: [],
    argvSpans: [],
    diagnostics: [],
    token: "",
    tokenStart: null,
    tokenEnd: null,
  };
}

function appendChar(scanner: Scanner, ch: string, index: number): void {
  if (scanner.tokenStart === null) {
    scanner.tokenStart = index;
  }
  scanner.token += ch;
  scanner.tokenEnd = index + 1;
}

function flushToken(scanner: Scanner, endIndex: number): void {
  if (scanner.tokenStart === null) {
    return;
  }
  scanner.argv.push(scanner.token);
  scanner.argvSpans.push(sourceSpan(scanner.tokenStart, scanner.tokenEnd ?? endIndex));
  scanner.token = "";
  scanner.tokenStart = null;
  scanner.tokenEnd = null;
}

function addUnsupportedSyntax(
  scanner: Scanner,
  code: string,
  severity: "error" | "warning",
  message: string,
  start: number,
  end: number,
): void {
  scanner.diagnostics.push(diagnostic(code, severity, message, start, end));
}

function scanUnsupportedOutsideQuote(scanner: Scanner, index: number): void {
  const { command, shellDialect } = scanner;
  const ch = command[index];
  const next = command[index + 1];

  if (ch === "$" && next === "(") {
    addUnsupportedSyntax(
      scanner,
      "E_SHELL_UNSUPPORTED_COMMAND_SUBSTITUTION",
      "error",
      "Command substitution is not executed",
      index,
      index + 2,
    );
    return;
  }

  if (ch === "`" && shellDialect !== "powershell") {
    addUnsupportedSyntax(
      scanner,
      "E_SHELL_UNSUPPORTED_COMMAND_SUBSTITUTION",
      "error",
      "Backtick command substitution is not executed",
      index,
      index + 1,
    );
    return;
  }

  if (ch === "|" || ch === "<" || ch === ">") {
    addUnsupportedSyntax(
      scanner,
      "E_SHELL_UNSUPPORTED_REDIRECTION",
      "error",
      "Pipelines and redirection are not executed",
      index,
      index + 1,
    );
    return;
  }

  if (ch === "$" && /[A-Za-z_{]/u.test(next ?? "")) {
    addUnsupportedSyntax(
      scanner,
      "W_SHELL_UNSUPPORTED_VARIABLE_EXPANSION",
      "warning",
      "Variable expansion is not performed",
      index,
      index + 1,
    );
    return;
  }

  if ((ch === "*" || ch === "?") && shellDialect !== "cmd") {
    addUnsupportedSyntax(
      scanner,
      "W_SHELL_UNSUPPORTED_GLOB",
      "warning",
      "Glob expansion is not performed",
      index,
      index + 1,
    );
    return;
  }

  if (ch === "{" && shellDialect !== "cmd") {
    addUnsupportedSyntax(
      scanner,
      "W_SHELL_UNSUPPORTED_BRACE_EXPANSION",
      "warning",
      "Brace expansion is not performed",
      index,
      index + 1,
    );
  }
}

function scanPosix(command: string, shellDialect: ShellDialect): Scanner {
  const scanner = createScanner(command, shellDialect);
  let quote: "'" | "\"" | null = null;

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    const next = command[i + 1];
    const nextNext = command[i + 2];

    if (quote === "'") {
      if (ch === "'") {
        quote = null;
      } else {
        appendChar(scanner, ch, i);
      }
      continue;
    }

    if (quote === "\"") {
      if (ch === "\"") {
        quote = null;
        continue;
      }
      if (ch === "\\" && i + 1 < command.length) {
        if (next === "\n") {
          i += 1;
          continue;
        }
        if (next === "\r" && nextNext === "\n") {
          i += 2;
          continue;
        }
        i += 1;
        appendChar(scanner, command[i], i);
        continue;
      }
      appendChar(scanner, ch, i);
      continue;
    }

    scanUnsupportedOutsideQuote(scanner, i);

    if (/\s/u.test(ch)) {
      flushToken(scanner, i);
      continue;
    }
    if (ch === "'") {
      if (scanner.tokenStart === null) {
        scanner.tokenStart = i;
      }
      quote = "'";
      continue;
    }
    if (ch === "\"") {
      if (scanner.tokenStart === null) {
        scanner.tokenStart = i;
      }
      quote = "\"";
      continue;
    }
    if (ch === "\\" && i + 1 < command.length) {
      if (next === "\n") {
        i += 1;
        continue;
      }
      if (next === "\r" && nextNext === "\n") {
        i += 2;
        continue;
      }
      i += 1;
      appendChar(scanner, command[i], i);
      continue;
    }
    appendChar(scanner, ch, i);
  }

  if (quote) {
    addUnsupportedSyntax(
      scanner,
      "E_SHELL_UNTERMINATED_QUOTE",
      "error",
      "Quoted string is not terminated",
      scanner.tokenStart ?? command.length,
      command.length,
    );
  }
  flushToken(scanner, command.length);
  return scanner;
}

function scanPowerShell(command: string): Scanner {
  const scanner = createScanner(command, "powershell");
  let quote: "'" | "\"" | null = null;

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];

    if (quote === "'") {
      if (ch === "'" && command[i + 1] === "'") {
        i += 1;
        appendChar(scanner, "'", i);
      } else if (ch === "'") {
        quote = null;
      } else {
        appendChar(scanner, ch, i);
      }
      continue;
    }

    if (quote === "\"") {
      if (ch === "\"") {
        quote = null;
      } else if (ch === "`" && i + 1 < command.length) {
        i += 1;
        appendChar(scanner, command[i], i);
      } else {
        appendChar(scanner, ch, i);
      }
      continue;
    }

    scanUnsupportedOutsideQuote(scanner, i);

    if (/\s/u.test(ch)) {
      flushToken(scanner, i);
      continue;
    }
    if (ch === "'" || ch === "\"") {
      if (scanner.tokenStart === null) {
        scanner.tokenStart = i;
      }
      quote = ch;
      continue;
    }
    if (ch === "`" && i + 1 < command.length) {
      i += 1;
      appendChar(scanner, command[i], i);
      continue;
    }
    appendChar(scanner, ch, i);
  }

  if (quote) {
    addUnsupportedSyntax(
      scanner,
      "E_SHELL_UNTERMINATED_QUOTE",
      "error",
      "Quoted string is not terminated",
      scanner.tokenStart ?? command.length,
      command.length,
    );
  }
  flushToken(scanner, command.length);
  return scanner;
}

function scanCmd(command: string): Scanner {
  const scanner = createScanner(command, "cmd");
  let quoted = false;

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];

    if (!quoted && /[%]/u.test(ch)) {
      addUnsupportedSyntax(
        scanner,
        "W_SHELL_UNSUPPORTED_VARIABLE_EXPANSION",
        "warning",
        "Variable expansion is not performed",
        i,
        i + 1,
      );
    }

    if (!quoted && (ch === "|" || ch === "<" || ch === ">")) {
      addUnsupportedSyntax(
        scanner,
        "E_SHELL_UNSUPPORTED_REDIRECTION",
        "error",
        "Pipelines and redirection are not executed",
        i,
        i + 1,
      );
    }

    if (ch === "\"") {
      if (scanner.tokenStart === null) {
        scanner.tokenStart = i;
      }
      quoted = !quoted;
      continue;
    }
    if (ch === "^" && i + 1 < command.length) {
      i += 1;
      appendChar(scanner, command[i], i);
      continue;
    }
    if (!quoted && /\s/u.test(ch)) {
      flushToken(scanner, i);
      continue;
    }
    appendChar(scanner, ch, i);
  }

  if (quoted) {
    addUnsupportedSyntax(
      scanner,
      "E_SHELL_UNTERMINATED_QUOTE",
      "error",
      "Quoted string is not terminated",
      scanner.tokenStart ?? command.length,
      command.length,
    );
  }
  flushToken(scanner, command.length);
  return scanner;
}

export function createParseInputFromArgv(
  argv: readonly string[],
  options: ParseCurlOptions & { argvSpans?: SourceSpan[] } = {},
): ParseInput {
  const argvSpans = options.argvSpans ?? null;
  if (!Array.isArray(argv) || argv.some((item) => typeof item !== "string")) {
    throw new TypeError("argv must be an array of strings");
  }
  if (argvSpans !== null && (!Array.isArray(argvSpans) || argvSpans.length !== argv.length)) {
    throw new TypeError("argvSpans must match argv length");
  }

  return {
    schemaVersion: "curl-parse-input/v2",
    inputMode: "argv",
    argv: [...argv],
    ...(argvSpans ? { argvSpans: argvSpans.map((span) => ({ ...span })) } : {}),
    ...(options.runtimeProfile ? { runtimeProfile: options.runtimeProfile } : {}),
    ...(options.parseMode ? { parseMode: options.parseMode } : {}),
  };
}

export function parseShellCommand(
  command: string,
  options: ParseCurlOptions = {},
): ShellParseResult {
  const shellDialect = options.shellDialect ?? "posix-sh";
  let scanner: Scanner;

  if (typeof command !== "string" || command.length === 0) {
    throw new TypeError("command must be a non-empty string");
  }
  if (!SUPPORTED_DIALECTS.has(shellDialect)) {
    throw new TypeError(`unsupported shellDialect: ${shellDialect}`);
  }

  if (shellDialect === "powershell") {
    scanner = scanPowerShell(command);
  } else if (shellDialect === "cmd") {
    scanner = scanCmd(command);
  } else {
    scanner = scanPosix(command, shellDialect);
  }

  return {
    input: createParseInputFromArgv(scanner.argv, {
      ...options,
      argvSpans: scanner.argvSpans,
    }),
    diagnostics: scanner.diagnostics,
    shellDialect,
  };
}

export const supportedShellDialects = [...SUPPORTED_DIALECTS];
