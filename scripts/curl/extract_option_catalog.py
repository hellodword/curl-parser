#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


ARG_TYPE_NAMES = {
    "ARG_NONE": "none",
    "ARG_BOOL": "bool",
    "ARG_STRG": "string",
    "ARG_FILE": "file",
    "ARG_SECS": "seconds",
    "ARG_UNUM": "unsigned-number",
}

DOC_LIST_KEYS = {"Tags", "Protocols", "Mutexed", "Requires", "Category"}


def parse_aliases(tool_getparam_path: Path) -> list[dict]:
    text = tool_getparam_path.read_text(encoding="utf-8")
    match = re.search(r"aliases\[]=\s*\{(.*?)\n\};", text, re.S)
    if not match:
        raise ValueError("failed to locate aliases table")

    body = match.group(1)
    entry_pattern = re.compile(
        r'\{\s*"(?P<long>[^"]+)"\s*,\s*(?P<desc>[^,]+?)\s*,\s*\'(?P<short>[^\']*)\'\s*,\s*(?P<cmd>C_[A-Z0-9_]+)\s*\}',
        re.S,
    )

    options = []
    for entry in entry_pattern.finditer(body):
        desc_tokens = [token.strip() for token in entry.group("desc").split("|")]
        arg_type = next(
            (ARG_TYPE_NAMES[token] for token in desc_tokens if token in ARG_TYPE_NAMES),
            "unknown",
        )
        short = entry.group("short")
        options.append(
            {
                "long": entry.group("long"),
                "short": None if short == " " else short,
                "cmd": entry.group("cmd"),
                "argType": arg_type,
                "argFlags": desc_tokens,
            }
        )

    if not options:
        raise ValueError("no options parsed from aliases table")
    return options


def parse_front_matter(doc_path: Path) -> dict:
    text = doc_path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return {}

    _, front_matter, _ = text.split("---\n", 2)
    data: dict[str, object] = {}
    active_key: str | None = None

    for raw_line in front_matter.splitlines():
        if not raw_line.strip():
            continue
        if raw_line.startswith("  - ") and active_key:
            data.setdefault(active_key, [])
            assert isinstance(data[active_key], list)
            data[active_key].append(raw_line[4:].strip())
            continue

        active_key = None
        if ":" not in raw_line:
            continue
        key, raw_value = raw_line.split(":", 1)
        key = key.strip()
        value = raw_value.strip()
        if key in DOC_LIST_KEYS:
            data[key] = value.split() if value else []
        elif value:
            data[key] = value
        else:
            data[key] = []
            active_key = key

    return data


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--curl-root", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    workspace_root = Path(__file__).resolve().parents[2]
    curl_root = (workspace_root / args.curl_root).resolve()
    options = parse_aliases(curl_root / "src/tool_getparam.c")

    docs_root = curl_root / "docs/cmdline-opts"
    for option in options:
      doc_metadata = parse_front_matter(docs_root / f'{option["long"]}.md') if (docs_root / f'{option["long"]}.md').is_file() else {}
      option["protocols"] = doc_metadata.get("Protocols", [])
      option["requires"] = doc_metadata.get("Requires", [])
      option["mutexed"] = doc_metadata.get("Mutexed", [])
      option["added"] = doc_metadata.get("Added")
      option["multi"] = doc_metadata.get("Multi")
      option["category"] = doc_metadata.get("Category", [])

    version = curl_root.name[len("curl-") :].replace("_", ".")
    output = {
        "curlSourceVersion": version,
        "options": options,
    }

    out_path = (workspace_root / args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
