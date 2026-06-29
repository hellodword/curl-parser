import { createHighlighter } from "shiki";
import type { HighlighterGeneric } from "shiki";

import type { Target } from "./types";

type PlaygroundLanguage = "javascript" | "python" | "go" | "rust" | "c" | "toml" | "json";
type PlaygroundTheme = "github-light";

let highlighterPromise: Promise<HighlighterGeneric<PlaygroundLanguage, PlaygroundTheme>> | null = null;

function getHighlighter(): Promise<HighlighterGeneric<PlaygroundLanguage, PlaygroundTheme>> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-light"],
      langs: ["javascript", "python", "go", "rust", "c", "toml", "json"],
    });
  }
  return highlighterPromise;
}

export function languageForFile(path: string, target: Target): PlaygroundLanguage {
  if (path.endsWith(".py") || target === "python.requests") {
    return "python";
  }
  if (path.endsWith(".go") || target === "go.net_http") {
    return "go";
  }
  if (path.endsWith(".rs") || target === "rust.reqwest") {
    return "rust";
  }
  if (path.endsWith(".c") || path.endsWith(".h") || target === "c.libcurl") {
    return "c";
  }
  if (path.endsWith(".toml") || path === "Cargo.toml") {
    return "toml";
  }
  return "javascript";
}

export async function highlightCode(code: string, language: PlaygroundLanguage): Promise<string> {
  const highlighter = await getHighlighter();
  return highlighter.codeToHtml(code, {
    lang: language,
    theme: "github-light",
  });
}

export function highlightJson(code: string): Promise<string> {
  return highlightCode(code, "json");
}
