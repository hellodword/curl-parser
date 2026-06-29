#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def load_json(path: str) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def version_to_tag_dir(version: str) -> Path:
    return REPO_ROOT / "third_party" / "curl" / f"curl-{version.replace('.', '_')}"


def option_index(payload: dict) -> dict[str, dict]:
    return {item["long"]: item for item in payload["options"]}


def normalize_list(value: list[str] | None) -> list[str]:
    return sorted(value or [])


def diff_mapping(
    old_index: dict[str, dict],
    new_index: dict[str, dict],
    field: str,
) -> list[str]:
    changed: list[str] = []
    for key in sorted(set(old_index) & set(new_index)):
        if old_index[key].get(field) != new_index[key].get(field):
            changed.append(key)
    return changed


def diff_list_field(
    old_index: dict[str, dict],
    new_index: dict[str, dict],
    field: str,
) -> list[str]:
    changed: list[str] = []
    for key in sorted(set(old_index) & set(new_index)):
        if normalize_list(old_index[key].get(field)) != normalize_list(new_index[key].get(field)):
            changed.append(key)
    return changed


def extract_operation_config_fields(path: Path) -> list[str]:
    lines = path.read_text(encoding="utf-8").splitlines()
    in_struct = False
    fields: list[str] = []

    for line in lines:
        stripped = line.strip()
        if stripped == "struct OperationConfig {":
            in_struct = True
            continue
        if in_struct and stripped == "};":
            break
        if not in_struct or not stripped or stripped.startswith("/*"):
            continue
        if stripped.startswith("BIT("):
            fields.append(stripped[len("BIT("):stripped.index(")")])
            continue
        match = re.search(r"([A-Za-z_][A-Za-z0-9_]*)\s*(?:;|\[)", stripped)
        if match:
            fields.append(match.group(1))

    return fields


def extract_tool_libinfo_state(path: Path) -> tuple[list[str], list[str]]:
    text = path.read_text(encoding="utf-8")
    protocols = sorted(set(re.findall(r"const char \*proto_([a-z0-9_]+)\s*=", text)))
    features = sorted(set(re.findall(r"bool feature_([a-z0-9_]+)\s*=", text)))
    return protocols, features


def extract_guard_index(payload: dict) -> dict[str, dict]:
    return payload


def write_section(lines: list[str], title: str, items: list[str]) -> None:
    lines.append(f"## {title}")
    if items:
        lines.extend(f"- {item}" for item in items)
    else:
        lines.append("- none")
    lines.append("")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--old-source", required=True)
    parser.add_argument("--new-source", required=True)
    parser.add_argument("--old-options", required=True)
    parser.add_argument("--new-options", required=True)
    parser.add_argument("--old-guards", required=True)
    parser.add_argument("--new-guards", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    old_source = load_json(args.old_source)
    new_source = load_json(args.new_source)
    old_options = load_json(args.old_options)
    new_options = load_json(args.new_options)
    old_guards = load_json(args.old_guards)
    new_guards = load_json(args.new_guards)

    old_option_index = option_index(old_options)
    new_option_index = option_index(new_options)
    old_guard_index = extract_guard_index(old_guards)
    new_guard_index = extract_guard_index(new_guards)

    old_sources = sorted(old_source["curlToolSources"] + old_source["curlxSources"])
    new_sources = sorted(new_source["curlToolSources"] + new_source["curlxSources"])
    added_sources = sorted(set(new_sources) - set(old_sources))
    removed_sources = sorted(set(old_sources) - set(new_sources))

    added_options = sorted(set(new_option_index) - set(old_option_index))
    removed_options = sorted(set(old_option_index) - set(new_option_index))
    changed_short = diff_mapping(old_option_index, new_option_index, "short")
    changed_arg_type = diff_mapping(old_option_index, new_option_index, "argType")
    changed_requires = diff_list_field(old_option_index, new_option_index, "requires")
    changed_protocols = diff_list_field(old_option_index, new_option_index, "protocols")
    changed_mutexed = diff_list_field(old_option_index, new_option_index, "mutexed")
    changed_added = diff_mapping(old_option_index, new_option_index, "added")

    added_guards = sorted(set(new_guard_index) - set(old_guard_index))
    removed_guards = sorted(set(old_guard_index) - set(new_guard_index))
    changed_guards = []
    for key in sorted(set(old_guard_index) & set(new_guard_index)):
        if old_guard_index[key] != new_guard_index[key]:
            changed_guards.append(key)

    old_tag_dir = version_to_tag_dir(old_source["curlSourceVersion"])
    new_tag_dir = version_to_tag_dir(new_source["curlSourceVersion"])
    old_fields = extract_operation_config_fields(old_tag_dir / "src" / "tool_cfgable.h")
    new_fields = extract_operation_config_fields(new_tag_dir / "src" / "tool_cfgable.h")
    added_fields = sorted(set(new_fields) - set(old_fields))
    removed_fields = sorted(set(old_fields) - set(new_fields))

    old_protocol_state, old_feature_state = extract_tool_libinfo_state(
        old_tag_dir / "src" / "tool_libinfo.c"
    )
    new_protocol_state, new_feature_state = extract_tool_libinfo_state(
        new_tag_dir / "src" / "tool_libinfo.c"
    )
    added_protocol_state = sorted(set(new_protocol_state) - set(old_protocol_state))
    removed_protocol_state = sorted(set(old_protocol_state) - set(new_protocol_state))
    added_feature_state = sorted(set(new_feature_state) - set(old_feature_state))
    removed_feature_state = sorted(set(old_feature_state) - set(new_feature_state))

    need_new_golden_tests = sorted(set(added_options) | set(changed_arg_type) | set(changed_protocols))
    need_manual_guard_review = sorted(set(added_guards) | set(removed_guards) | set(changed_guards))

    lines: list[str] = []
    lines.append(
        f"# curl upgrade report: {old_source['curlSourceVersion']} -> {new_source['curlSourceVersion']}"
    )
    lines.append("")
    write_section(lines, "Added Source Files", added_sources)
    write_section(lines, "Removed Source Files", removed_sources)
    write_section(lines, "Added Options", added_options)
    write_section(lines, "Removed Options", removed_options)
    write_section(lines, "Short Option Changes", changed_short)
    write_section(lines, "Argument Type Changes", changed_arg_type)
    write_section(lines, "Requires Changes", changed_requires)
    write_section(lines, "Protocols Changes", changed_protocols)
    write_section(lines, "Mutexed Changes", changed_mutexed)
    write_section(lines, "Added Version Changes", changed_added)
    write_section(lines, "OperationConfig Added Fields", added_fields)
    write_section(lines, "OperationConfig Removed Fields", removed_fields)
    write_section(lines, "tool_libinfo Added Protocol State", added_protocol_state)
    write_section(lines, "tool_libinfo Removed Protocol State", removed_protocol_state)
    write_section(lines, "tool_libinfo Added Feature State", added_feature_state)
    write_section(lines, "tool_libinfo Removed Feature State", removed_feature_state)
    write_section(lines, "Added Guards", added_guards)
    write_section(lines, "Removed Guards", removed_guards)
    write_section(lines, "Changed Guards", changed_guards)
    write_section(lines, "Need New Golden Tests", need_new_golden_tests)
    write_section(lines, "Need Manual Guard Review", need_manual_guard_review)

    Path(args.out).write_text("\n".join(lines), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
