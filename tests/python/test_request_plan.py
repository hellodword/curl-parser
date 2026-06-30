#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
CAPABILITY_DIR = REPO_ROOT / "generators" / "capabilities"
SCHEMA_DIR = REPO_ROOT / "schemas"
BEHAVIOR_REGISTRY = REPO_ROOT / "packages" / "node" / "src" / "generator" / "behaviors.ts"
BEHAVIOR_ENTRY_PATTERN = re.compile(r'\{\s*id: "([^"]+)",.*?enabled: (true|false),\s*\}', re.DOTALL)
CAPABILITY_LEVELS = {
    "native",
    "lossy",
    "requires-runtime-helper",
    "unsupported",
}
SUPPORT_LEVELS = {
    "exact",
    "lossy",
    "requires-runtime-helper",
    "unsupported",
}
SUPPORT_ITEM_LEVELS = {
    "lossy",
    "requires-runtime-helper",
    "unsupported",
}


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def behavior_registry_ids() -> list[str]:
    ids = [
        behavior_id
        for behavior_id, enabled in BEHAVIOR_ENTRY_PATTERN.findall(BEHAVIOR_REGISTRY.read_text(encoding="utf-8"))
        if enabled == "true"
    ]
    assert ids, "behavior registry must define IDs"
    assert len(ids) == len(set(ids)), "behavior registry IDs must be unique"
    return ids


def target_ids() -> list[str]:
    schema = load_json(SCHEMA_DIR / "generate-input.v2.schema.json")
    targets = schema["$defs"]["target"]["enum"]
    assert isinstance(targets, list)
    assert all(isinstance(target, str) for target in targets)
    return targets


def validate_capability_manifest(path: Path, target: str, required_behaviors: list[str]) -> None:
    payload = load_json(path)
    assert payload["schemaVersion"] == "curl-target-capabilities/v2"
    assert payload["target"] == target
    assert isinstance(payload["library"]["name"], str)
    assert isinstance(payload["library"]["ecosystem"], str)
    behaviors = payload["behaviors"]
    missing = [name for name in required_behaviors if name not in behaviors]
    assert not missing, f"{path}: missing behaviors {missing}"
    for behavior, entry in behaviors.items():
        assert behavior in required_behaviors, f"{path}: unexpected behavior {behavior}"
        assert entry["id"] == behavior
        assert entry["capability"] in CAPABILITY_LEVELS
        assert isinstance(entry["message"], str) and entry["message"]


def validate_capability_matrix() -> None:
    required_behaviors = behavior_registry_ids()
    for target in target_ids():
        path = CAPABILITY_DIR / f"{target}.json"
        validate_capability_manifest(path, target, required_behaviors)


def generate_with_node(argv: list[str], target: str) -> dict[str, Any]:
    script = """
import { generateCode, parseCurl } from './packages/node/dist/node.js';
const argv = JSON.parse(process.argv[1]);
const target = process.argv[2];
const parsed = await parseCurl(argv);
const output = await generateCode(parsed, { target });
console.log(JSON.stringify(output));
"""
    completed = subprocess.run(
        ["node", "--input-type=module", "-e", script, json.dumps(argv), target],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        check=True,
    )
    return json.loads(completed.stdout)


def validate_request_plan(
    output: dict[str, Any],
    target: str,
    *,
    files_empty: bool = True,
) -> None:
    behavior_ids = set(behavior_registry_ids())
    assert output["schemaVersion"] == "curl-generate-output/v2"
    assert output["target"] == target
    if files_empty:
        assert output["files"] == []
    else:
        assert isinstance(output["files"], list) and output["files"]
    assert output["plan"]["target"] == target
    transfers = output["plan"]["transfers"]
    assert isinstance(transfers, list) and transfers
    for transfer in transfers:
        assert set(transfer) == {"id", "steps"}
        assert isinstance(transfer["id"], str)
        assert isinstance(transfer["steps"], list) and transfer["steps"]
        for step in transfer["steps"]:
            assert set(step).issubset({"behavior", "capability", "message"})
            assert isinstance(step["behavior"], str)
            assert step["behavior"] in behavior_ids
            assert step["capability"] in CAPABILITY_LEVELS
            if "message" in step:
                assert isinstance(step["message"], str)

    support = output["support"]
    assert support["level"] in SUPPORT_LEVELS
    assert isinstance(support["items"], list)
    for item in support["items"]:
        assert set(item).issubset({"behavior", "level", "message", "source"})
        assert isinstance(item["behavior"], str)
        assert item["behavior"] in behavior_ids
        assert item["level"] in SUPPORT_ITEM_LEVELS
        assert isinstance(item["message"], str)

    diagnostics = output["diagnostics"]
    assert isinstance(diagnostics, list)
    for diagnostic in diagnostics:
        assert diagnostic["code"].startswith(("E_", "W_", "I_"))
        assert diagnostic["severity"] in {"fatal", "error", "warning", "info"}
        assert diagnostic["category"] in {
            "input",
            "shell",
            "curl",
            "profile",
            "support",
            "target",
            "internal",
        }
        assert isinstance(diagnostic["message"], str)


def steps_by_behavior(output: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        step["behavior"]: step
        for transfer in output["plan"]["transfers"]
        for step in transfer["steps"]
    }


def test_js_fetch_http3_is_unsupported() -> None:
    output = generate_with_node(["curl", "--http3", "https://example.com"], "js.fetch")
    validate_request_plan(output, "js.fetch", files_empty=False)
    steps = steps_by_behavior(output)
    assert steps["http.version.3"]["capability"] == "unsupported"
    assert output["support"]["level"] == "unsupported"
    assert output["support"]["items"] == [
        {
            "behavior": "http.version.3",
            "level": "unsupported",
            "message": "Target cannot preserve HTTP/3 selection",
        }
    ]
    assert output["diagnostics"][0]["code"] == "E_TARGET_UNSUPPORTED"
    assert output["diagnostics"][0]["details"] == {
        "target": "js.fetch",
        "behavior": "http.version.3",
    }


def test_httpx_http2_is_exact() -> None:
    output = generate_with_node(["curl", "--http2", "https://example.com"], "python.httpx")
    validate_request_plan(output, "python.httpx", files_empty=False)
    steps = steps_by_behavior(output)
    assert steps["http.version.2"]["capability"] == "native"
    assert output["support"] == {"level": "exact", "items": []}
    assert output["diagnostics"] == []


def test_go_http2_prior_knowledge_is_lossy() -> None:
    output = generate_with_node(["curl", "--http2-prior-knowledge", "https://example.com"], "go.net_http")
    validate_request_plan(output, "go.net_http", files_empty=False)
    steps = steps_by_behavior(output)
    assert steps["http.version.2"]["capability"] == "lossy"
    assert output["support"]["level"] == "lossy"
    assert output["diagnostics"][0]["code"] == "W_TARGET_LOSSY"


def test_go_dns_network_require_helper() -> None:
    output = generate_with_node(
        [
            "curl",
            "--resolve",
            "example.com:443:203.0.113.10",
            "--interface",
            "eth0",
            "https://example.com",
        ],
        "go.net_http",
    )
    validate_request_plan(output, "go.net_http", files_empty=False)
    steps = steps_by_behavior(output)
    assert steps["dns"]["capability"] == "requires-runtime-helper"
    assert steps["network"]["capability"] == "requires-runtime-helper"
    assert output["support"]["level"] == "requires-runtime-helper"


def test_rust_reqwest_tls_verify_is_unsafe_lossy() -> None:
    output = generate_with_node(["curl", "-k", "https://example.com"], "rust.reqwest")
    validate_request_plan(output, "rust.reqwest", files_empty=False)
    steps = steps_by_behavior(output)
    assert steps["tls.verify"]["capability"] == "lossy"
    assert output["support"]["level"] == "lossy"
    assert output["diagnostics"][0]["code"] == "W_TARGET_UNSAFE"


def test_rust_reqwest_dns_network_require_helper() -> None:
    output = generate_with_node(
        [
            "curl",
            "--resolve",
            "example.com:443:203.0.113.10",
            "--interface",
            "eth0",
            "--connect-to",
            "example.com:443:backend.example:8443",
            "https://example.com",
        ],
        "rust.reqwest",
    )
    validate_request_plan(output, "rust.reqwest", files_empty=False)
    steps = steps_by_behavior(output)
    assert steps["dns"]["capability"] == "requires-runtime-helper"
    assert steps["network"]["capability"] == "requires-runtime-helper"
    assert output["support"]["level"] == "requires-runtime-helper"


def main() -> int:
    validate_capability_matrix()
    test_js_fetch_http3_is_unsupported()
    test_httpx_http2_is_exact()
    test_go_http2_prior_knowledge_is_lossy()
    test_go_dns_network_require_helper()
    test_rust_reqwest_tls_verify_is_unsafe_lossy()
    test_rust_reqwest_dns_network_require_helper()
    print("request plan ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
