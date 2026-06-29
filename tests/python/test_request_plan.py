#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
CAPABILITY_DIR = REPO_ROOT / "generators" / "capabilities"
REQUIRED_TARGETS = [
    "c.libcurl",
    "python.requests",
    "js.fetch",
    "go.net_http",
    "rust.reqwest",
]
REQUIRED_BEHAVIORS = [
    "url",
    "method",
    "headers",
    "body.raw",
    "body.multipart",
    "auth.basic",
    "cookies.inline",
    "proxy",
    "tls.verify",
    "redirects",
    "timeout",
    "http.version.2",
    "http.version.3",
    "external-ref",
]
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


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_capability_manifest(path: Path, target: str) -> None:
    payload = load_json(path)
    assert payload["schemaVersion"] == "curl-target-capabilities/v1"
    assert payload["target"] == target
    assert isinstance(payload["library"]["name"], str)
    assert isinstance(payload["library"]["ecosystem"], str)
    behaviors = payload["behaviors"]
    missing = [name for name in REQUIRED_BEHAVIORS if name not in behaviors]
    assert not missing, f"{path}: missing behaviors {missing}"
    for behavior, entry in behaviors.items():
        assert behavior in REQUIRED_BEHAVIORS, f"{path}: unexpected behavior {behavior}"
        assert entry["capability"] in CAPABILITY_LEVELS
        assert isinstance(entry["message"], str) and entry["message"]


def validate_capability_matrix() -> None:
    for target in REQUIRED_TARGETS:
        validate_capability_manifest(CAPABILITY_DIR / f"{target}.json", target)


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
    assert output["schemaVersion"] == "curl-generate-output/v1"
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
            assert step["capability"] in CAPABILITY_LEVELS
            if "message" in step:
                assert isinstance(step["message"], str)

    support = output["support"]
    assert support["level"] in SUPPORT_LEVELS
    assert isinstance(support["items"], list)
    for item in support["items"]:
        assert set(item).issubset({"behavior", "level", "message", "source"})
        assert isinstance(item["behavior"], str)
        assert item["level"] in SUPPORT_LEVELS
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


def test_libcurl_http3_is_exact() -> None:
    output = generate_with_node(["curl", "--http3", "https://example.com"], "c.libcurl")
    validate_request_plan(output, "c.libcurl", files_empty=False)
    steps = steps_by_behavior(output)
    assert steps["http.version.3"]["capability"] == "native"
    assert output["support"] == {"level": "exact", "items": []}
    assert output["diagnostics"] == []


def main() -> int:
    validate_capability_matrix()
    test_js_fetch_http3_is_unsupported()
    test_libcurl_http3_is_exact()
    print("request plan ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
