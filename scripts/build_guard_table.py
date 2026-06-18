#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
from pathlib import Path


REQUIRES_TO_FEATURE = {
    "HTTP/2": "HTTP2",
    "HTTP/3": "HTTP3",
    "HTTPS-proxy": "HTTPS-proxy",
    "SSL": "SSL",
}

SPECIAL_GUARDS = {
    "compressed": {
        "requiresAnyFeatures": ["libz", "brotli", "zstd"],
    },
    "proxy": {
        "valueSchemeGuards": {
            "https": {
                "requiresFeatures": ["HTTPS-proxy"],
            }
        }
    },
}

HTTPS_ONLY_OPTIONS = {"http3", "http3-only"}


def dedupe(values: list[str]) -> list[str]:
    seen = set()
    ordered = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered


def build_guard(option: dict) -> dict:
    guard: dict[str, object] = {}
    requires_features = [
        REQUIRES_TO_FEATURE[item]
        for item in option.get("requires", [])
        if item in REQUIRES_TO_FEATURE
    ]

    if not requires_features and "ARG_TLS" in option.get("argFlags", []):
        requires_features.append("SSL")

    if requires_features:
        guard["requiresFeatures"] = dedupe(requires_features)

    if option["long"] in HTTPS_ONLY_OPTIONS:
        guard["requiresUrlSchemes"] = ["https"]
        guard["disallowsProxy"] = True

    special = SPECIAL_GUARDS.get(option["long"])
    if special:
        guard.update(special)

    return guard


def render_guard_header(guards: dict, version: str) -> str:
    version_id = version.replace(".", "_")
    guard_name = f"CURLPARSE_GUARDS_{version_id}_H"
    lines = [
        f"#ifndef {guard_name}",
        f"#define {guard_name}",
        "",
        "#include <stdbool.h>",
        "",
        "struct CurlparseOptionGuard {",
        "  const char *option;",
        "  const char *requires_features[8];",
        "  const char *requires_any_features[8];",
        "  const char *requires_url_schemes[8];",
        "  bool disallows_proxy;",
        "};",
        "",
        f"static const struct CurlparseOptionGuard curlparse_guards_{version_id}[] = {{",
    ]

    for option_name, guard in guards.items():
        requires_features = guard.get("requiresFeatures", [])
        requires_any = guard.get("requiresAnyFeatures", [])
        requires_schemes = guard.get("requiresUrlSchemes", [])

        def as_c_array(values: list[str]) -> str:
            padded = [f'"{value}"' for value in values[:7]]
            padded.append("NULL")
            while len(padded) < 8:
                padded.append("NULL")
            return "{ " + ", ".join(padded) + " }"

        lines.append(
            "  {"
            f'"{option_name}", '
            f"{as_c_array(requires_features)}, "
            f"{as_c_array(requires_any)}, "
            f"{as_c_array(requires_schemes)}, "
            f'{"true" if guard.get("disallowsProxy") else "false"}'
            "},"
        )

    lines.extend(["};", "", "#endif", ""])
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--options", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--header", required=True)
    args = parser.parse_args()

    workspace_root = Path(__file__).resolve().parent.parent
    options_path = (workspace_root / args.options).resolve()
    options_payload = json.loads(options_path.read_text(encoding="utf-8"))

    guards = {}
    for option in options_payload["options"]:
        guard = build_guard(option)
        if guard:
            guards[option["long"]] = guard

    out_path = (workspace_root / args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(guards, indent=2) + "\n", encoding="utf-8")

    header_path = (workspace_root / args.header).resolve()
    header_path.parent.mkdir(parents=True, exist_ok=True)
    header_path.write_text(
        render_guard_header(guards, options_payload["curlSourceVersion"]),
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
