#!/usr/bin/env python3

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path


UPSTREAM_REPOSITORY = "https://github.com/curl/curl"
COPY_PATHS = [
    "src",
    "lib",
    "include",
    "docs/cmdline-opts",
    "COPYING",
    "README.md",
]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def copy_selected_paths(repo_root: Path, destination_root: Path) -> None:
    for relative_path in COPY_PATHS:
        source_path = repo_root / relative_path
        destination_path = destination_root / relative_path
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        if source_path.is_dir():
            shutil.copytree(source_path, destination_path)
        else:
            shutil.copy2(source_path, destination_path)


def build_manifest(destination_root: Path, tag: str, commit: str) -> dict:
    files = []
    for path in sorted(destination_root.rglob("*")):
        if not path.is_file():
            continue
        relative_path = path.relative_to(destination_root).as_posix()
        if relative_path == "manifest.json":
            continue
        files.append(
            {
                "path": relative_path,
                "sha256": sha256_file(path),
                "size": path.stat().st_size,
            }
        )

    return {
        "tag": tag,
        "upstreamRepository": UPSTREAM_REPOSITORY,
        "upstreamCommit": commit,
        "files": files,
        "licenseFiles": ["COPYING"],
    }


def clone_repository(tag: str, checkout_root: Path) -> Path:
    repo_root = checkout_root / "curl"
    subprocess.run(
        [
            "git",
            "clone",
            "--depth",
            "1",
            "--branch",
            tag,
            UPSTREAM_REPOSITORY,
            str(repo_root),
        ],
        check=True,
    )
    return repo_root


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", default="curl-8_20_0")
    parser.add_argument(
        "--output-root",
        default="third_party/curl",
        help="Directory that will contain the vendored curl tag directory.",
    )
    args = parser.parse_args()

    workspace_root = Path(__file__).resolve().parent.parent
    output_root = (workspace_root / args.output_root).resolve()
    destination_root = output_root / args.tag

    with tempfile.TemporaryDirectory(prefix="curl-parser-vendor-") as tmp_dir:
        temp_root = Path(tmp_dir)
        repo_root = clone_repository(args.tag, temp_root)
        commit = (
            subprocess.run(
                ["git", "rev-parse", "HEAD"],
                check=True,
                cwd=repo_root,
                capture_output=True,
                text=True,
            )
            .stdout.strip()
        )

        if destination_root.exists():
            shutil.rmtree(destination_root)
        destination_root.parent.mkdir(parents=True, exist_ok=True)
        copy_selected_paths(repo_root, destination_root)

    manifest = build_manifest(destination_root, args.tag, commit)
    manifest_path = destination_root / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(manifest_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
