#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
GOLDEN_DIR = REPO_ROOT / "fixtures" / "golden"
NATIVE_CLI = REPO_ROOT / "build" / "native" / "curlparse_cli"


def canonicalize(text: str) -> str:
    return json.dumps(
        json.loads(text),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ) + "\n"


def build_native() -> None:
    subprocess.run(
        ["python", "scripts/tasks.py", "build-native"],
        cwd=REPO_ROOT,
        check=True,
    )


def run_native(input_text: str) -> str:
    completed = subprocess.run(
        [str(NATIVE_CLI)],
        cwd=REPO_ROOT,
        input=input_text,
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        if completed.stderr:
            sys.stderr.write(completed.stderr)
        raise RuntimeError(f"native parser failed with exit code {completed.returncode}")
    return canonicalize(completed.stdout)


def case_stems() -> list[str]:
    stems = []
    for path in sorted(GOLDEN_DIR.glob("*.input.json")):
        stems.append(path.name[:-len(".input.json")])
    return stems


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--update", action="store_true")
    args = parser.parse_args()

    stems = case_stems()
    if not stems:
        sys.stderr.write("no golden input files found\n")
        return 1

    build_native()

    passed = 0
    failed = 0

    for stem in stems:
        input_path = GOLDEN_DIR / f"{stem}.input.json"
        output_path = GOLDEN_DIR / f"{stem}.output.json"
        actual = run_native(input_path.read_text(encoding="utf-8"))

        if args.update:
            output_path.write_text(actual, encoding="utf-8")
            print(f"updated {stem}")
            continue

        if not output_path.exists():
            print(f"missing {output_path.name}")
            failed += 1
            continue

        expected = canonicalize(output_path.read_text(encoding="utf-8"))
        if actual == expected:
            passed += 1
            print(f"ok {stem}")
        else:
            failed += 1
            print(f"mismatch {stem}")

    if args.update:
        print(f"updated {len(stems)} cases")
        return 0

    print(f"{passed} passed")
    print(f"{failed} failed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
