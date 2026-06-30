#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_DIR = REPO_ROOT / "schemas"
GOLDEN_DIR = REPO_ROOT / "fixtures" / "golden"
PARSE_FIXTURE_DIR = REPO_ROOT / "fixtures" / "parse"
NATIVE_VS_WASM_DIR = REPO_ROOT / "fixtures" / "native-vs-wasm" / "cases"
PROFILE_DIR = REPO_ROOT / "profiles"
CAPABILITY_DIR = REPO_ROOT / "generators" / "capabilities"
BEHAVIOR_REGISTRY = REPO_ROOT / "packages" / "node" / "src" / "generator" / "behaviors.ts"
NATIVE_CLI = REPO_ROOT / "build" / "native" / "curlparse_cli"

REQUIRED_SCHEMAS = [
    "parse-input.v2.schema.json",
    "parse-output.v2.schema.json",
    "curl-ir.v2.schema.json",
    "diagnostics.v2.schema.json",
    "generate-input.v2.schema.json",
    "generate-output.v2.schema.json",
    "runtime-profile.v2.schema.json",
    "target-capabilities.v2.schema.json",
]

CURL_GUARD_DIAGNOSTIC_CODES = {
    "parse-error",
    "option-not-available",
    "protocol-not-available",
    "feature-not-available",
}

STABLE_CODE_PATTERN = re.compile(r"^(E|W|I)_[A-Z0-9_]+$")
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
BEHAVIOR_ENTRY_PATTERN = re.compile(r'\{\s*id: "([^"]+)",.*?enabled: (true|false),\s*\}', re.DOTALL)
CAPABILITY_LEVELS = {
    "native",
    "lossy",
    "requires-runtime-helper",
    "unsupported",
}
SUPPORT_ITEM_LEVELS = {
    "lossy",
    "requires-runtime-helper",
    "unsupported",
}


def fail(path: Path, message: str) -> None:
    rel = path.relative_to(REPO_ROOT)
    raise AssertionError(f"{rel}: {message}")


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        fail(path, f"invalid JSON: {exc}")


def behavior_registry_ids() -> list[str]:
    text = BEHAVIOR_REGISTRY.read_text(encoding="utf-8")
    ids = [
        behavior_id
        for behavior_id, enabled in BEHAVIOR_ENTRY_PATTERN.findall(text)
        if enabled == "true"
    ]
    if not ids:
        fail(BEHAVIOR_REGISTRY, "missing enabled behavior IDs")
    duplicates = sorted({item for item in ids if ids.count(item) > 1})
    if duplicates:
        fail(BEHAVIOR_REGISTRY, f"duplicate behavior IDs: {duplicates}")
    return ids


def target_schema_ids() -> list[str]:
    schema = load_json(SCHEMA_DIR / "generate-input.v2.schema.json")
    target_enum = schema.get("$defs", {}).get("target", {}).get("enum")
    if not isinstance(target_enum, list) or not all(isinstance(item, str) for item in target_enum):
        fail(SCHEMA_DIR / "generate-input.v2.schema.json", "target enum must be string[]")
    return target_enum


def external_ref_kind_ids() -> set[str]:
    path = SCHEMA_DIR / "curl-ir.v2.schema.json"
    schema = load_json(path)
    kind_enum = (
        schema.get("$defs", {})
        .get("externalRef", {})
        .get("properties", {})
        .get("kind", {})
        .get("enum")
    )
    if not isinstance(kind_enum, list) or not all(isinstance(item, str) for item in kind_enum):
        fail(path, "$defs.externalRef.properties.kind.enum must be string[]")
    return set(kind_enum)


def assert_type(path: Path, value: Any, expected: type, field: str) -> None:
    if not isinstance(value, expected):
        fail(path, f"{field} must be {expected.__name__}")


def validate_schema_inventory() -> None:
    missing = [name for name in REQUIRED_SCHEMAS if not (SCHEMA_DIR / name).is_file()]
    if missing:
        raise AssertionError(f"missing schemas: {', '.join(missing)}")

    for path in sorted(SCHEMA_DIR.glob("*.json")):
        schema = load_json(path)
        assert_type(path, schema, dict, "$")
        if "$schema" not in schema:
            fail(path, "missing $schema")
        if schema.get("additionalProperties") is True:
            fail(path, "top-level additionalProperties must not be true")


def validate_capability_manifest(path: Path, target: str, required_behaviors: list[str]) -> None:
    payload = load_json(path)
    assert_type(path, payload, dict, "$")
    if payload.get("schemaVersion") != "curl-target-capabilities/v2":
        fail(path, "schemaVersion must be curl-target-capabilities/v2")
    if payload.get("target") != target:
        fail(path, f"target must be {target}")
    library = payload.get("library")
    assert_type(path, library, dict, "library")
    for key in ["name", "ecosystem"]:
        if not isinstance(library.get(key), str) or not library[key]:
            fail(path, f"library.{key} must be non-empty string")
    if "minimumVersion" in library and not isinstance(library["minimumVersion"], str):
        fail(path, "library.minimumVersion must be string")
    if "notes" in library and not isinstance(library["notes"], str):
        fail(path, "library.notes must be string")

    behaviors = payload.get("behaviors")
    assert_type(path, behaviors, dict, "behaviors")
    missing = [name for name in required_behaviors if name not in behaviors]
    unexpected = sorted(name for name in behaviors if name not in required_behaviors)
    if missing:
        fail(path, f"missing behavior classifications: {missing}")
    if unexpected:
        fail(path, f"unexpected behavior classifications: {unexpected}")

    for behavior in required_behaviors:
        entry = behaviors[behavior]
        entry_field = f"behaviors.{behavior}"
        assert_type(path, entry, dict, entry_field)
        if entry.get("id") != behavior:
            fail(path, f"{entry_field}.id must match behavior key")
        if entry.get("capability") not in CAPABILITY_LEVELS:
            fail(path, f"{entry_field}.capability is invalid")
        if not isinstance(entry.get("message"), str) or not entry["message"]:
            fail(path, f"{entry_field}.message must be non-empty string")
        for key in ["notes", "requiredDependency", "requiredRuntime", "requiredFeature", "unsafeWhen"]:
            if key in entry and (not isinstance(entry[key], str) or not entry[key]):
                fail(path, f"{entry_field}.{key} must be non-empty string")


def validate_capability_matrix() -> None:
    required_behaviors = behavior_registry_ids()
    targets = target_schema_ids()
    for target in targets:
        path = CAPABILITY_DIR / f"{target}.json"
        if not path.is_file():
            fail(path, "missing target capability manifest")
        validate_capability_manifest(path, target, required_behaviors)


def validate_runtime_profile(path: Path, profile: Any, field: str) -> None:
    assert_type(path, profile, dict, field)
    if profile.get("schemaVersion") != "curl-runtime-profile/v2":
        fail(path, f"{field}.schemaVersion must be curl-runtime-profile/v2")
    assert_type(path, profile.get("curlVersion"), str, f"{field}.curlVersion")
    protocols = profile.get("protocols")
    features = profile.get("features")
    assert_type(path, protocols, list, f"{field}.protocols")
    assert_type(path, features, list, f"{field}.features")
    if not all(isinstance(item, str) for item in protocols):
        fail(path, f"{field}.protocols must contain strings")
    if not all(isinstance(item, str) for item in features):
        fail(path, f"{field}.features must contain strings")

    compile_block = profile.get("compile")
    if compile_block is not None:
        assert_type(path, compile_block, dict, f"{field}.compile")
        for key in ["disabledOptions", "defines"]:
            if key in compile_block and not isinstance(compile_block[key], list):
                fail(path, f"{field}.compile.{key} must be array")
        available = compile_block.get("availableOptions")
    if available is not None and not isinstance(available, list):
        fail(path, f"{field}.compile.availableOptions must be array or null")

    option_catalog = profile.get("optionCatalog")
    if option_catalog is not None:
        assert_type(path, option_catalog, dict, f"{field}.optionCatalog")
        for key in ["curlVersion", "source"]:
            if not isinstance(option_catalog.get(key), str):
                fail(path, f"{field}.optionCatalog.{key} must be string")
        sha256 = option_catalog.get("sha256")
        if sha256 is not None and (not isinstance(sha256, str) or not SHA256_PATTERN.match(sha256)):
            fail(path, f"{field}.optionCatalog.sha256 is invalid")

    for key in ["sslBackend", "http3Backend", "resolverBackend"]:
        if key in profile and not (profile[key] is None or isinstance(profile[key], str)):
            fail(path, f"{field}.{key} must be string or null")

    defaults = profile.get("defaults")
    if defaults is not None:
        assert_type(path, defaults, dict, f"{field}.defaults")
        if "userAgent" in defaults and not (
            defaults["userAgent"] is None or isinstance(defaults["userAgent"], str)
        ):
            fail(path, f"{field}.defaults.userAgent must be string or null")
        if "httpVersion" in defaults and not (
            defaults["httpVersion"] is None or isinstance(defaults["httpVersion"], int)
        ):
            fail(path, f"{field}.defaults.httpVersion must be integer or null")
        if "followRedirects" in defaults and not isinstance(defaults["followRedirects"], bool):
            fail(path, f"{field}.defaults.followRedirects must be boolean")


def validate_source_span(path: Path, source: Any, field: str) -> None:
    assert_type(path, source, dict, field)
    if source.get("source") not in {"command", "argv", "generated"}:
        fail(path, f"{field}.source is invalid")
    for key in ["start", "end"]:
        if not isinstance(source.get(key), int):
            fail(path, f"{field}.{key} must be integer")
    if "argvIndex" in source and not isinstance(source["argvIndex"], int):
        fail(path, f"{field}.argvIndex must be integer")
    if "path" in source and not isinstance(source["path"], str):
        fail(path, f"{field}.path must be string")


def validate_external_refs(path: Path, refs: Any, field: str) -> None:
    allowed_kinds = external_ref_kind_ids()
    assert_type(path, refs, list, field)
    for index, ref in enumerate(refs):
        ref_field = f"{field}[{index}]"
        assert_type(path, ref, dict, ref_field)
        if not isinstance(ref.get("id"), str):
            fail(path, f"{ref_field}.id must be string")
        if ref.get("kind") not in allowed_kinds:
            fail(path, f"{ref_field}.kind is invalid")
        if not isinstance(ref.get("access"), str):
            fail(path, f"{ref_field}.access must be string")
        for key in ["option", "value"]:
            if key in ref and not (ref[key] is None or isinstance(ref[key], str)):
                fail(path, f"{ref_field}.{key} must be string or null")
        if ref.get("source") is not None:
            validate_source_span(path, ref["source"], f"{ref_field}.source")


def validate_external_ref_links(path: Path, ir: dict[str, Any], field: str) -> None:
    refs = ir.get("externalRefs")
    if not isinstance(refs, list):
        return
    ref_ids = {ref.get("id") for ref in refs if isinstance(ref, dict) and isinstance(ref.get("id"), str)}

    def walk(value: Any, current: str) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                if key.endswith("RefId") and isinstance(item, str) and item not in ref_ids:
                    fail(path, f"{current}.{key} does not resolve: {item}")
                walk(item, f"{current}.{key}")
        elif isinstance(value, list):
            for index, item in enumerate(value):
                walk(item, f"{current}[{index}]")

    walk(ir, field)


def validate_ir(path: Path, ir: Any, field: str) -> None:
    assert_type(path, ir, dict, field)
    if ir.get("schemaVersion") != "curl-ir/v2":
        fail(path, f"{field}.schemaVersion must be curl-ir/v2")
    command = ir.get("command")
    assert_type(path, command, dict, f"{field}.command")
    assert_type(path, command.get("argv"), list, f"{field}.command.argv")
    runtime = ir.get("runtime")
    assert_type(path, runtime, dict, f"{field}.runtime")
    validate_runtime_profile(path, runtime.get("profile"), f"{field}.runtime.profile")
    validate_external_refs(path, ir.get("externalRefs"), f"{field}.externalRefs")
    validate_external_ref_links(path, ir, field)
    groups = ir.get("groups")
    assert_type(path, groups, list, f"{field}.groups")
    for group_index, group in enumerate(groups):
        group_field = f"{field}.groups[{group_index}]"
        assert_type(path, group, dict, group_field)
        assert_type(path, group.get("transfers"), list, f"{group_field}.transfers")
        for transfer_index, transfer in enumerate(group["transfers"]):
            transfer_field = f"{group_field}.transfers[{transfer_index}]"
            assert_type(path, transfer, dict, transfer_field)
            if not isinstance(transfer.get("url"), str):
                fail(path, f"{transfer_field}.url must be string")
            assert_type(path, transfer.get("effective"), dict, f"{transfer_field}.effective")
    diagnostics = ir.get("diagnostics")
    assert_type(path, diagnostics, list, f"{field}.diagnostics")
    for index, item in enumerate(diagnostics):
        validate_diagnostic(path, item, f"{field}.diagnostics[{index}]")


def validate_parse_input(path: Path) -> None:
    payload = load_json(path)
    assert_type(path, payload, dict, "$")
    if payload.get("schemaVersion") != "curl-parse-input/v2":
        fail(path, "schemaVersion must be curl-parse-input/v2")
    if payload.get("inputMode") != "argv":
        fail(path, "fixtures must use argv inputMode until shell parser lands")
    argv = payload.get("argv")
    assert_type(path, argv, list, "argv")
    if not argv or not all(isinstance(item, str) for item in argv):
        fail(path, "argv must be a non-empty string array")
    parse_mode = payload.get("parseMode")
    if parse_mode is not None and parse_mode not in {"strict", "diagnostic"}:
        fail(path, "parseMode must be strict or diagnostic")
    if "runtimeProfile" in payload:
        validate_runtime_profile(path, payload["runtimeProfile"], "runtimeProfile")


def validate_diagnostic(path: Path, item: Any, field: str) -> None:
    assert_type(path, item, dict, field)
    code = item.get("code")
    if not isinstance(code, str):
        fail(path, f"{field}.code must be string")
    if code not in CURL_GUARD_DIAGNOSTIC_CODES and not STABLE_CODE_PATTERN.match(code):
        fail(path, f"{field}.code is not stable: {code}")
    if "severity" in item:
        if item.get("severity") not in {"fatal", "error", "warning", "info"}:
            fail(path, f"{field}.severity is invalid")
        if item.get("category") not in {
            "input",
            "shell",
            "curl",
            "profile",
            "support",
            "target",
            "internal",
        }:
            fail(path, f"{field}.category is invalid")
        if not isinstance(item.get("message"), str):
            fail(path, f"{field}.message must be string")
        if "path" in item and not isinstance(item["path"], str):
            fail(path, f"{field}.path must be string")
        details = item.get("details")
        if details is not None:
            assert_type(path, details, dict, f"{field}.details")
        return
    if "option" not in item or not (item["option"] is None or isinstance(item["option"], str)):
        fail(path, f"{field}.option must be string or null")
    if "detail" not in item or not (item["detail"] is None or isinstance(item["detail"], str)):
        fail(path, f"{field}.detail must be string or null")
    if not isinstance(item.get("warning"), bool):
        fail(path, f"{field}.warning must be boolean")


def validate_parse_output(path: Path) -> None:
    payload = load_json(path)
    validate_parse_output_payload(path, payload)


def validate_parse_output_payload(path: Path, payload: Any, field: str = "$") -> None:
    assert_type(path, payload, dict, "$")
    if payload.get("schemaVersion") != "curl-parse-output/v2":
        fail(path, f"{field}.schemaVersion must be curl-parse-output/v2")
    assert_type(path, payload.get("ok"), bool, f"{field}.ok")
    assert_type(path, payload.get("curlSourceVersion"), str, f"{field}.curlSourceVersion")
    assert_type(path, payload.get("argv"), list, f"{field}.argv")
    assert_type(path, payload.get("operations"), list, f"{field}.operations")
    assert_type(path, payload.get("events"), list, f"{field}.events")
    assert_type(path, payload.get("diagnostics"), list, f"{field}.diagnostics")
    assert_type(path, payload.get("errors"), list, f"{field}.errors")
    validate_runtime_profile(path, payload.get("runtimeProfileApplied"), f"{field}.runtimeProfileApplied")
    if "ir" in payload:
        validate_ir(path, payload["ir"], f"{field}.ir")

    for index, operation in enumerate(payload["operations"]):
        operation_field = f"{field}.operations[{index}]"
        assert_type(path, operation, dict, operation_field)
        if not isinstance(operation.get("index"), int):
            fail(path, f"{operation_field}.index must be integer")
        assert_type(path, operation.get("urls"), list, f"{operation_field}.urls")
        assert_type(path, operation.get("config"), dict, f"{operation_field}.config")

    for index, event in enumerate(payload["events"]):
        event_field = f"{field}.events[{index}]"
        assert_type(path, event, dict, event_field)
        for key in ["operation", "argvIndex"]:
            if not isinstance(event.get(key), int):
                fail(path, f"{event_field}.{key} must be integer")
        for key in ["usedNextArg", "negated", "isNext", "isPositional"]:
            if not isinstance(event.get(key), bool):
                fail(path, f"{event_field}.{key} must be boolean")

    for index, item in enumerate(payload["diagnostics"]):
        validate_diagnostic(path, item, f"{field}.diagnostics[{index}]")
    for index, item in enumerate(payload["errors"]):
        validate_diagnostic(path, item, f"{field}.errors[{index}]")


def validate_fixture_ref_links(path: Path, expected: dict[str, Any], field: str) -> None:
    refs = expected.get("externalRefs")
    if not isinstance(refs, list):
        return
    ref_ids = {ref.get("id") for ref in refs if isinstance(ref, dict) and isinstance(ref.get("id"), str)}

    def walk(value: Any, current: str) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                if key.endswith("RefId") and isinstance(item, str) and item not in ref_ids:
                    fail(path, f"{current}.{key} does not resolve: {item}")
                walk(item, f"{current}.{key}")
        elif isinstance(value, list):
            for index, item in enumerate(value):
                walk(item, f"{current}[{index}]")

    walk(expected.get("effective"), f"{field}.effective")


def validate_expected_external_refs(path: Path, refs: Any, field: str) -> None:
    allowed_kinds = external_ref_kind_ids()
    assert_type(path, refs, list, field)
    for index, ref in enumerate(refs):
        ref_field = f"{field}[{index}]"
        assert_type(path, ref, dict, ref_field)
        if not isinstance(ref.get("id"), str):
            fail(path, f"{ref_field}.id must be string")
        if ref.get("kind") not in allowed_kinds:
            fail(path, f"{ref_field}.kind is invalid")
        if "access" in ref and not isinstance(ref["access"], str):
            fail(path, f"{ref_field}.access must be string")
        for key in ["option", "value"]:
            if key in ref and not (ref[key] is None or isinstance(ref[key], str)):
                fail(path, f"{ref_field}.{key} must be string or null")
        if "source" in ref and ref["source"] is not None:
            validate_source_span(path, ref["source"], f"{ref_field}.source")


def validate_parse_fixture_file(path: Path) -> None:
    payload = load_json(path)
    assert_type(path, payload, dict, "$")
    if payload.get("schemaVersion") != "curl-parser-fixtures/v1":
        fail(path, "schemaVersion must be curl-parser-fixtures/v1")
    cases = payload.get("cases")
    assert_type(path, cases, list, "cases")
    for index, test_case in enumerate(cases):
        case_field = f"cases[{index}]"
        assert_type(path, test_case, dict, case_field)
        if "argv" in test_case:
            argv = test_case["argv"]
            assert_type(path, argv, list, f"{case_field}.argv")
            if not all(isinstance(item, str) for item in argv):
                fail(path, f"{case_field}.argv must contain strings")
        expected = test_case.get("expected")
        if expected is None:
            continue
        assert_type(path, expected, dict, f"{case_field}.expected")
        if "externalRefs" in expected:
            validate_expected_external_refs(path, expected["externalRefs"], f"{case_field}.expected.externalRefs")
            validate_fixture_ref_links(path, expected, f"{case_field}.expected")
        for key in ["diagnostics", "errors"]:
            if key in expected:
                assert_type(path, expected[key], list, f"{case_field}.expected.{key}")
                for diagnostic_index, item in enumerate(expected[key]):
                    validate_diagnostic(
                        path,
                        item,
                        f"{case_field}.expected.{key}[{diagnostic_index}]",
                    )


def native_parse(argv: list[str]) -> dict[str, Any]:
    payload = {
        "schemaVersion": "curl-parse-input/v2",
        "inputMode": "argv",
        "argv": argv,
    }
    completed = subprocess.run(
        [str(NATIVE_CLI)],
        cwd=REPO_ROOT,
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        check=True,
    )
    result = json.loads(completed.stdout)
    if not isinstance(result, dict):
        raise AssertionError("native parse output must be object")
    return result


def validate_parse_fixture_outputs() -> None:
    for path in sorted(PARSE_FIXTURE_DIR.glob("*/*.json")):
        validate_parse_fixture_file(path)
        if not NATIVE_CLI.exists():
            continue
        payload = load_json(path)
        for index, test_case in enumerate(payload.get("cases", [])):
            argv = test_case.get("argv")
            if isinstance(argv, list) and all(isinstance(item, str) for item in argv):
                validate_parse_output_payload(
                    path,
                    native_parse(argv),
                    f"cases[{index}].actual",
                )


def main() -> int:
    try:
        validate_schema_inventory()
        for path in sorted(GOLDEN_DIR.glob("*.input.json")):
            validate_parse_input(path)
        for path in sorted(NATIVE_VS_WASM_DIR.glob("*.json")):
            validate_parse_input(path)
        for path in sorted(GOLDEN_DIR.glob("*.output.json")):
            validate_parse_output(path)
        validate_parse_fixture_outputs()
        for path in sorted(PROFILE_DIR.glob("*.json")):
            validate_runtime_profile(path, load_json(path), "$")
        validate_capability_matrix()
    except AssertionError as exc:
        print(exc, file=sys.stderr)
        return 1

    print("contracts ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
