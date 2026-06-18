#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
CASES_DIR = REPO_ROOT / "tests" / "native-vs-wasm" / "cases"
NATIVE_CLI = REPO_ROOT / "build" / "native" / "curlparse_cli"
WASM_PATH = REPO_ROOT / "dist" / "curl_parser.wasm"
VENV_PYTHON = REPO_ROOT / ".venv" / "bin" / "python"

NODE_SNIPPET = """
import { readFileSync } from 'node:fs';
import { createCurlParserWasm } from './wrappers/node/index.mjs';

const input = JSON.parse(readFileSync(0, 'utf8'));
const parser = await createCurlParserWasm();
const output = parser.parse(input);
process.stdout.write(JSON.stringify(output));
"""

PYTHON_SNIPPET = """
import json
import sys
from pathlib import Path

sys.path.insert(0, str((Path.cwd() / "wrappers" / "python").resolve()))
from curl_parser_wasm import CurlParserWasm

input_obj = json.load(sys.stdin)
parser = CurlParserWasm(Path("dist") / "curl_parser.wasm")
output = parser.parse(input_obj)
sys.stdout.write(json.dumps(output, separators=(",", ":"), ensure_ascii=False))
"""


def run_command(args: list[str], input_text: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=REPO_ROOT,
        input=input_text,
        text=True,
        capture_output=True,
        check=False,
    )


def normalize_json(text: str) -> str:
    return json.dumps(
        json.loads(text),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )


def build_artifacts() -> None:
    subprocess.run(
        ["python", "scripts/tasks.py", "build-native"],
        cwd=REPO_ROOT,
        check=True,
    )
    subprocess.run(
        ["python", "scripts/tasks.py", "build-wasm"],
        cwd=REPO_ROOT,
        check=True,
    )


def python_runner() -> list[str]:
    if VENV_PYTHON.exists():
      return [str(VENV_PYTHON)]
    return [sys.executable]


def execute_native(case_json: str) -> subprocess.CompletedProcess[str]:
    return run_command([str(NATIVE_CLI)], case_json)


def execute_node(case_json: str) -> subprocess.CompletedProcess[str]:
    return run_command(
        ["node", "--input-type=module", "-e", NODE_SNIPPET],
        case_json,
    )


def execute_python(case_json: str) -> subprocess.CompletedProcess[str]:
    return run_command(
        python_runner() + ["-c", PYTHON_SNIPPET],
        case_json,
    )


def load_case_files() -> list[Path]:
    return sorted(CASES_DIR.glob("*.json"))


def report_failure(
    case_path: Path,
    label: str,
    completed: subprocess.CompletedProcess[str],
) -> None:
    sys.stderr.write(f"[{case_path.name}] {label} command failed\n")
    sys.stderr.write(f"exit code: {completed.returncode}\n")
    if completed.stderr:
        sys.stderr.write(completed.stderr)
        if not completed.stderr.endswith("\n"):
            sys.stderr.write("\n")


def report_mismatch(
    case_path: Path,
    native_json: str,
    node_json: str,
    python_json: str,
) -> None:
    sys.stderr.write(f"[{case_path.name}] output mismatch\n")
    sys.stderr.write(f"native: {native_json}\n")
    sys.stderr.write(f"node:   {node_json}\n")
    sys.stderr.write(f"python: {python_json}\n")


def main() -> int:
    case_paths = load_case_files()
    if not case_paths:
        sys.stderr.write("no native-vs-wasm cases found\n")
        return 1

    build_artifacts()

    for case_path in case_paths:
        case_json = case_path.read_text(encoding="utf-8")

        native_result = execute_native(case_json)
        if native_result.returncode != 0:
            report_failure(case_path, "native", native_result)
            return 1

        node_result = execute_node(case_json)
        if node_result.returncode != 0:
            report_failure(case_path, "node", node_result)
            return 1

        python_result = execute_python(case_json)
        if python_result.returncode != 0:
            report_failure(case_path, "python", python_result)
            return 1

        native_json = normalize_json(native_result.stdout)
        node_json = normalize_json(node_result.stdout)
        python_json = normalize_json(python_result.stdout)

        if native_json != node_json or native_json != python_json:
            report_mismatch(case_path, native_json, node_json, python_json)
            return 1

        print(f"ok {case_path.name}")

    print("native == node wasm")
    print("native == python wasm")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
