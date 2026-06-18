#!/usr/bin/env python3
from __future__ import annotations

import argparse
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def version_from_tag(tag: str) -> str:
    if not tag.startswith("curl-"):
        raise ValueError(f"unsupported tag format: {tag}")
    return tag[len("curl-"):].replace("_", ".")


def run(args: list[str]) -> None:
    subprocess.run(args, cwd=REPO_ROOT, check=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--old-version", required=True)
    parser.add_argument("--new-tag", required=True)
    args = parser.parse_args()

    new_version = version_from_tag(args.new_tag)
    new_tag_dir = REPO_ROOT / "third_party" / "curl" / args.new_tag
    new_underscored = new_version.replace(".", "_")

    run(["python", "scripts/vendor_curl.py", "--tag", args.new_tag])
    run(
        [
            "python",
            "scripts/extract_source_inventory.py",
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
            "scripts/extract_option_catalog.py",
            "--curl-root",
            str(new_tag_dir),
            "--out",
            f"build/generated/options-{new_version}.json",
        ]
    )
    run(
        [
            "python",
            "scripts/build_guard_table.py",
            "--options",
            f"build/generated/options-{new_version}.json",
            "--out",
            f"build/generated/guards-{new_version}.json",
            "--header",
            f"src/generated/curlparse_guards_{new_underscored}.h",
        ]
    )
    run(
        [
            "python",
            "scripts/compare_curl_version.py",
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
