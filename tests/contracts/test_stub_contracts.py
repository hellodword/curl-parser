#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
NATIVE_CLI = REPO_ROOT / "build" / "native" / "curlparse_cli"


def parse(argv: list[str]) -> dict[str, Any]:
    payload = {
        "schemaVersion": "curl-parse-input/v1",
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
    return json.loads(completed.stdout)


def main() -> int:
    contracts = json.loads(
        (REPO_ROOT / "core/c/src/runtime/stub-contracts.json").read_text(encoding="utf-8")
    )
    levels = {item["level"] for item in contracts["stubs"]}
    assert {"approximated", "unimplemented-loud", "parse-only-safe"} <= levels

    output = parse(["curl", "--data-urlencode", "a=b", "https://example.com"])
    diagnostics = output["diagnostics"]
    assert any(item["code"] == "W_RUNTIME_STUB_APPROXIMATED" for item in diagnostics)

    print("stub contracts ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
