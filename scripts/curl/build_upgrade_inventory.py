#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any, *, sort_keys: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=sort_keys) + "\n", encoding="utf-8")


def source_version_from_tag(curl_root: Path) -> str:
    tag = curl_root.name
    if not tag.startswith("curl-"):
        raise ValueError(f"unexpected curl source directory name: {tag}")
    return tag[len("curl-") :].replace("_", ".")


def repo_path(workspace_root: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(workspace_root.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def extract_operation_config_fields(workspace_root: Path, path: Path) -> dict[str, Any]:
    lines = path.read_text(encoding="utf-8").splitlines()
    in_struct = False
    guard_stack: list[str] = []
    fields: list[dict[str, Any]] = []

    for line_number, raw_line in enumerate(lines, start=1):
        stripped = raw_line.strip()
        if stripped == "struct OperationConfig {":
            in_struct = True
            continue
        if in_struct and stripped == "};":
            break
        if not in_struct:
            continue

        if stripped.startswith("#if"):
            guard_stack.append(stripped)
            continue
        if stripped.startswith("#else") or stripped.startswith("#elif"):
            if guard_stack:
                guard_stack[-1] = stripped
            continue
        if stripped.startswith("#endif"):
            if guard_stack:
                guard_stack.pop()
            continue

        declaration = stripped.split("/*", 1)[0].strip()
        if not declaration:
            continue

        name: str | None = None
        if declaration.startswith("BIT("):
            name = declaration[len("BIT(") : declaration.index(")")]
        else:
            match = re.search(r"([A-Za-z_][A-Za-z0-9_]*)\s*(?:;|\[)", declaration)
            if match:
                name = match.group(1)

        if name:
            fields.append({
                "name": name,
                "declaration": declaration,
                "line": line_number,
                "preprocessorGuards": list(guard_stack),
            })

    if not fields:
        raise ValueError(f"no OperationConfig fields found in {path}")

    return {
        "source": repo_path(workspace_root, path),
        "fieldNames": [field["name"] for field in fields],
        "fields": fields,
    }


def parse_c_string_array(text: str, name: str) -> list[str]:
    pattern = re.compile(
        rf"static const char \*const {re.escape(name)}\[\]\s*=\s*\{{(?P<body>.*?)\n\}};",
        re.S,
    )
    match = pattern.search(text)
    if not match:
        raise ValueError(f"failed to locate {name} array")
    return re.findall(r'"([^"]+)"', match.group("body"))


def extract_runtime_features(workspace_root: Path, curl_root: Path, profile_path: Path) -> dict[str, Any]:
    libinfo_path = curl_root / "src" / "tool_libinfo.c"
    libinfo = libinfo_path.read_text(encoding="utf-8")
    profile = profile_path.read_text(encoding="utf-8")

    protocol_state_variables = [
        {
            "name": name,
            "variable": f"proto_{name}",
            "initialValue": value.strip('"'),
        }
        for name, value in re.findall(
            r"const char \*proto_([a-z0-9_]+)\s*=\s*(NULL|\"[^\"]+\");",
            libinfo,
        )
    ]
    protocol_entries = [
        {"name": name, "variable": variable}
        for name, variable in re.findall(
            r'\{\s*"([^"]+)"\s*,\s*&([A-Za-z_][A-Za-z0-9_]*)\s*\}',
            libinfo,
        )
    ]
    feature_state_variables = [
        {"name": name, "variable": f"feature_{name}", "initialValue": value}
        for name, value in re.findall(r"bool feature_([A-Za-z0-9_]+)\s*=\s*(TRUE|FALSE);", libinfo)
    ]
    feature_entries = [
        {
            "name": name,
            "stateVariable": None if pointer == "NULL" else pointer.removeprefix("&"),
            "bitmask": bitmask,
        }
        for name, pointer, bitmask in re.findall(
            r'\{\s*"([^"]+)"\s*,\s*(&[A-Za-z_][A-Za-z0-9_]*|NULL)\s*,\s*([^}\s]+)\s*\}',
            libinfo,
        )
    ]

    return {
        "source": repo_path(workspace_root, libinfo_path),
        "profileSource": repo_path(workspace_root, profile_path),
        "protocolStateVariables": protocol_state_variables,
        "protocolEntries": protocol_entries,
        "featureStateVariables": feature_state_variables,
        "featureEntries": feature_entries,
        "defaultProfile": {
            "protocols": parse_c_string_array(profile, "default_protocols"),
            "features": parse_c_string_array(profile, "default_features"),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--curl-root", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--options", required=True)
    parser.add_argument("--guards", required=True)
    parser.add_argument("--out-dir", required=True)
    args = parser.parse_args()

    workspace_root = Path(__file__).resolve().parents[2]
    curl_root = (workspace_root / args.curl_root).resolve()
    out_dir = (workspace_root / args.out_dir).resolve()
    version = source_version_from_tag(curl_root)

    source_inventory = load_json((workspace_root / args.source).resolve())
    option_catalog = load_json((workspace_root / args.options).resolve())
    guards = load_json((workspace_root / args.guards).resolve())

    write_json(out_dir / "curl-source-inventory.json", source_inventory)
    write_json(out_dir / "curl-options.json", option_catalog)
    write_json(out_dir / "curl-guards.json", guards, sort_keys=True)
    write_json(
        out_dir / "curl-operation-config-fields.json",
        {
            "curlSourceVersion": version,
            **extract_operation_config_fields(workspace_root, curl_root / "src" / "tool_cfgable.h"),
        },
    )
    write_json(
        out_dir / "curl-runtime-features.json",
        {
            "curlSourceVersion": version,
            **extract_runtime_features(
                workspace_root,
                curl_root,
                workspace_root / "core/c/src/runtime/curlparse_profile.c",
            ),
        },
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
