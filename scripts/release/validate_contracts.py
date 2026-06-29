#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_DIR = REPO_ROOT / "schemas"
GOLDEN_DIR = REPO_ROOT / "fixtures" / "golden"
NATIVE_VS_WASM_DIR = REPO_ROOT / "fixtures" / "native-vs-wasm" / "cases"
PROFILE_DIR = REPO_ROOT / "profiles"

REQUIRED_SCHEMAS = [
    "parse-input.v1.schema.json",
    "parse-output.v1.schema.json",
    "curl-ir.v1.schema.json",
    "diagnostics.v1.schema.json",
    "generate-input.v1.schema.json",
    "generate-output.v1.schema.json",
    "runtime-profile.v1.schema.json",
    "target-capabilities.v1.schema.json",
]

CURL_GUARD_DIAGNOSTIC_CODES = {
    "parse-error",
    "option-not-available",
    "protocol-not-available",
    "feature-not-available",
}

STABLE_CODE_PATTERN = re.compile(r"^(E|W|I)_[A-Z0-9_]+$")
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")


def fail(path: Path, message: str) -> None:
    rel = path.relative_to(REPO_ROOT)
    raise AssertionError(f"{rel}: {message}")


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        fail(path, f"invalid JSON: {exc}")


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


def validate_runtime_profile(path: Path, profile: Any, field: str) -> None:
    assert_type(path, profile, dict, field)
    if profile.get("schemaVersion") != "curl-runtime-profile/v1":
        fail(path, f"{field}.schemaVersion must be curl-runtime-profile/v1")
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
    assert_type(path, refs, list, field)
    for index, ref in enumerate(refs):
        ref_field = f"{field}[{index}]"
        assert_type(path, ref, dict, ref_field)
        if not isinstance(ref.get("id"), str):
            fail(path, f"{ref_field}.id must be string")
        if ref.get("kind") not in {
            "file",
            "stdin",
            "directory",
            "output-file",
            "cookie-jar",
            "netrc",
            "unix-socket",
            "os-trust-store",
            "os-client-cert-store",
            "network-interface",
            "local-file-url",
        }:
            fail(path, f"{ref_field}.kind is invalid")
        if not isinstance(ref.get("access"), str):
            fail(path, f"{ref_field}.access must be string")
        for key in ["option", "value"]:
            if key in ref and not (ref[key] is None or isinstance(ref[key], str)):
                fail(path, f"{ref_field}.{key} must be string or null")
        if ref.get("source") is not None:
            validate_source_span(path, ref["source"], f"{ref_field}.source")


def validate_ir(path: Path, ir: Any, field: str) -> None:
    assert_type(path, ir, dict, field)
    if ir.get("schemaVersion") != "curl-ir/v1":
        fail(path, f"{field}.schemaVersion must be curl-ir/v1")
    command = ir.get("command")
    assert_type(path, command, dict, f"{field}.command")
    assert_type(path, command.get("argv"), list, f"{field}.command.argv")
    runtime = ir.get("runtime")
    assert_type(path, runtime, dict, f"{field}.runtime")
    validate_runtime_profile(path, runtime.get("profile"), f"{field}.runtime.profile")
    validate_external_refs(path, ir.get("externalRefs"), f"{field}.externalRefs")
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


def validate_parse_input(path: Path) -> None:
    payload = load_json(path)
    assert_type(path, payload, dict, "$")
    if payload.get("schemaVersion") != "curl-parse-input/v1":
        fail(path, "schemaVersion must be curl-parse-input/v1")
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
    assert_type(path, payload, dict, "$")
    if payload.get("schemaVersion") != "curl-parse-output/v1":
        fail(path, "schemaVersion must be curl-parse-output/v1")
    assert_type(path, payload.get("ok"), bool, "ok")
    assert_type(path, payload.get("curlSourceVersion"), str, "curlSourceVersion")
    assert_type(path, payload.get("argv"), list, "argv")
    assert_type(path, payload.get("operations"), list, "operations")
    assert_type(path, payload.get("events"), list, "events")
    assert_type(path, payload.get("diagnostics"), list, "diagnostics")
    assert_type(path, payload.get("errors"), list, "errors")
    validate_runtime_profile(path, payload.get("runtimeProfileApplied"), "runtimeProfileApplied")
    if "ir" in payload:
        validate_ir(path, payload["ir"], "ir")

    for index, operation in enumerate(payload["operations"]):
        assert_type(path, operation, dict, f"operations[{index}]")
        if not isinstance(operation.get("index"), int):
            fail(path, f"operations[{index}].index must be integer")
        assert_type(path, operation.get("urls"), list, f"operations[{index}].urls")
        assert_type(path, operation.get("config"), dict, f"operations[{index}].config")

    for index, event in enumerate(payload["events"]):
        assert_type(path, event, dict, f"events[{index}]")
        for key in ["operation", "argvIndex"]:
            if not isinstance(event.get(key), int):
                fail(path, f"events[{index}].{key} must be integer")
        for key in ["usedNextArg", "negated", "isNext", "isPositional"]:
            if not isinstance(event.get(key), bool):
                fail(path, f"events[{index}].{key} must be boolean")

    for index, item in enumerate(payload["diagnostics"]):
        validate_diagnostic(path, item, f"diagnostics[{index}]")
    for index, item in enumerate(payload["errors"]):
        validate_diagnostic(path, item, f"errors[{index}]")


def main() -> int:
    try:
        validate_schema_inventory()
        for path in sorted(GOLDEN_DIR.glob("*.input.json")):
            validate_parse_input(path)
        for path in sorted(NATIVE_VS_WASM_DIR.glob("*.json")):
            validate_parse_input(path)
        for path in sorted(GOLDEN_DIR.glob("*.output.json")):
            validate_parse_output(path)
        for path in sorted(PROFILE_DIR.glob("*.json")):
            validate_runtime_profile(path, load_json(path), "$")
    except AssertionError as exc:
        print(exc, file=sys.stderr)
        return 1

    print("contracts ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
