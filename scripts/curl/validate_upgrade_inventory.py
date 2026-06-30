#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


VALID_STATUSES = {
    "mapped-to-ir",
    "external-ref",
    "parse-time-rejected-host-dependency",
    "runtime-profile-guarded",
    "intentionally-ignored",
    "unsupported",
}


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise SystemExit(
            f"missing {path.as_posix()}; run nix develop --command python scripts/tasks.py generate"
        ) from exc


def classified_names(payload: dict[str, Any], section_name: str, errors: list[str]) -> set[str]:
    section = payload.get(section_name)
    if not isinstance(section, dict):
        errors.append(f"classification section {section_name!r} is missing or not an object")
        return set()

    seen: dict[str, str] = {}
    result: set[str] = set()
    for status, names in section.items():
        if status not in VALID_STATUSES:
            errors.append(f"{section_name}: unknown status {status!r}")
            continue
        if not isinstance(names, list) or not all(isinstance(name, str) for name in names):
            errors.append(f"{section_name}.{status}: expected a list of strings")
            continue
        sorted_names = sorted(names)
        if names != sorted_names:
            errors.append(f"{section_name}.{status}: names must be sorted")
        for name in names:
            if name in seen:
                errors.append(f"{section_name}: {name!r} appears in both {seen[name]!r} and {status!r}")
            seen[name] = status
            result.add(name)
    return result


def validate_section(
    *,
    section_name: str,
    expected: set[str],
    classified: set[str],
    errors: list[str],
) -> None:
    unknown = sorted(expected - classified)
    stale = sorted(classified - expected)
    if unknown:
        errors.append(f"{section_name}: unknown generated names: {', '.join(unknown)}")
    if stale:
        errors.append(f"{section_name}: stale classified names: {', '.join(stale)}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--classification", required=True)
    parser.add_argument("--options", required=True)
    parser.add_argument("--guards", required=True)
    parser.add_argument("--fields", required=True)
    parser.add_argument("--runtime-features", required=True)
    args = parser.parse_args()

    workspace_root = Path(__file__).resolve().parents[2]
    classification = load_json(workspace_root / args.classification)
    options = load_json(workspace_root / args.options)
    guards = load_json(workspace_root / args.guards)
    fields = load_json(workspace_root / args.fields)
    runtime_features = load_json(workspace_root / args.runtime_features)

    errors: list[str] = []
    if classification.get("schemaVersion") != "curl-option-classification/v1":
        errors.append("classification schemaVersion must be curl-option-classification/v1")

    option_names = {option["long"] for option in options.get("options", [])}
    guard_names = set(guards)
    field_names = set(fields.get("fieldNames", []))
    runtime_feature_names = {entry["name"] for entry in runtime_features.get("featureEntries", [])}
    runtime_protocol_names = {entry["name"] for entry in runtime_features.get("protocolStateVariables", [])}

    validate_section(
        section_name="options",
        expected=option_names,
        classified=classified_names(classification, "options", errors),
        errors=errors,
    )
    validate_section(
        section_name="operationConfigFields",
        expected=field_names,
        classified=classified_names(classification, "operationConfigFields", errors),
        errors=errors,
    )
    validate_section(
        section_name="guards",
        expected=guard_names,
        classified=classified_names(classification, "guards", errors),
        errors=errors,
    )
    validate_section(
        section_name="runtimeFeatures",
        expected=runtime_feature_names,
        classified=classified_names(classification, "runtimeFeatures", errors),
        errors=errors,
    )
    validate_section(
        section_name="runtimeProtocols",
        expected=runtime_protocol_names,
        classified=classified_names(classification, "runtimeProtocols", errors),
        errors=errors,
    )

    if errors:
        print("curl upgrade inventory validation failed:")
        for error in errors:
            print(f"- {error}")
        raise SystemExit(1)

    print("curl upgrade inventory ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
