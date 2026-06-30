#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = REPO_ROOT / "config" / "curl-source.json"


def version_from_tag(tag: str) -> str:
    if not tag.startswith("curl-"):
        raise ValueError(f"unsupported tag format: {tag}")
    return tag[len("curl-"):].replace("_", ".")


def run(args: list[str]) -> None:
    subprocess.run(args, cwd=REPO_ROOT, check=True)


def main() -> int:
    current_source = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    parser = argparse.ArgumentParser()
    parser.add_argument("--old-version", default=current_source["version"])
    parser.add_argument("--new-tag", required=True)
    args = parser.parse_args()

    new_version = version_from_tag(args.new_tag)
    new_tag_dir = REPO_ROOT / "third_party" / "curl" / args.new_tag

    run(["python", "scripts/curl/vendor_curl.py", "--tag", args.new_tag])
    run(
        [
            "python",
            "scripts/curl/extract_source_inventory.py",
            "--curl-root",
            str(new_tag_dir),
            "--out",
            f"build/generated/source-inventory-{new_version}.json",
            "--rsp",
            f"build/generated/curlparse_sources-{new_version}.rsp",
        ]
    )
    run(
        [
            "python",
            "scripts/curl/extract_option_catalog.py",
            "--curl-root",
            str(new_tag_dir),
            "--out",
            f"build/generated/options-{new_version}.json",
        ]
    )
    run(
        [
            "python",
            "scripts/build/build_guard_table.py",
            "--options",
            f"build/generated/options-{new_version}.json",
            "--out",
            f"build/generated/guards-{new_version}.json",
            "--header",
            "build/generated/include/curlparse/generated/curlparse_guards.h",
        ]
    )
    run(
        [
            "python",
            "scripts/curl/build_upgrade_inventory.py",
            "--curl-root",
            str(new_tag_dir),
            "--source",
            f"build/generated/source-inventory-{new_version}.json",
            "--options",
            f"build/generated/options-{new_version}.json",
            "--guards",
            f"build/generated/guards-{new_version}.json",
            "--out-dir",
            "build/generated",
        ]
    )
    run(
        [
            "python",
            "scripts/curl/compare_curl_version.py",
            "--old-source",
            f"build/generated/source-inventory-{args.old_version}.json",
            "--new-source",
            f"build/generated/source-inventory-{new_version}.json",
            "--old-options",
            f"build/generated/options-{args.old_version}.json",
            "--new-options",
            f"build/generated/options-{new_version}.json",
            "--old-guards",
            f"build/generated/guards-{args.old_version}.json",
            "--new-guards",
            f"build/generated/guards-{new_version}.json",
            "--out",
            f"build/generated/upgrade-{args.old_version}-to-{new_version}.md",
        ]
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
