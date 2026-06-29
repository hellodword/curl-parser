#!/usr/bin/env python3
from __future__ import annotations

import stat
import sys
import tempfile
from pathlib import Path
from typing import Callable


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "build"))

from wasm_assets import (  # noqa: E402
    NODE_WASM_ASSET,
    check_wasm_assets,
    sha256_file,
    sync_wasm_assets,
)


def write_root_wasm(repo_root: Path, data: bytes = b"wasm bytes") -> Path:
    source = repo_root / "dist" / "curl_parser.wasm"
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_bytes(data)
    source.chmod(0o644)
    return source


def expect_exit_contains(callback: Callable[[], object], text: str) -> None:
    try:
        callback()
    except SystemExit as exc:
        message = str(exc)
        assert text in message, message
    else:
        raise AssertionError(f"expected SystemExit containing {text!r}")


def with_temp_repo(callback: Callable[[Path], None]) -> None:
    with tempfile.TemporaryDirectory() as directory:
        callback(Path(directory))


def test_sync_and_check_generated_asset() -> None:
    def run(repo_root: Path) -> None:
        source = write_root_wasm(repo_root)
        targets = sync_wasm_assets(repo_root=repo_root)
        checked = check_wasm_assets(repo_root=repo_root)

        assert len(targets) == 1
        assert checked == [NODE_WASM_ASSET.relative_path.as_posix()]
        for target in targets:
            assert target.read_bytes() == source.read_bytes()
            assert sha256_file(target) == sha256_file(source)
            assert not target.stat().st_mode & (stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    with_temp_repo(run)


def test_missing_root_wasm_fails() -> None:
    with_temp_repo(lambda repo_root: expect_exit_contains(
        lambda: check_wasm_assets(repo_root=repo_root),
        "build-wasm",
    ))


def test_missing_target_fails() -> None:
    def run(repo_root: Path) -> None:
        write_root_wasm(repo_root)
        expect_exit_contains(lambda: check_wasm_assets(repo_root=repo_root), "missing")

    with_temp_repo(run)


def test_mismatch_fails() -> None:
    def run(repo_root: Path) -> None:
        write_root_wasm(repo_root)
        sync_wasm_assets(repo_root=repo_root)
        (repo_root / NODE_WASM_ASSET.relative_path).write_bytes(b"different")
        expect_exit_contains(lambda: check_wasm_assets(repo_root=repo_root), "differs")

    with_temp_repo(run)


def test_executable_target_fails() -> None:
    def run(repo_root: Path) -> None:
        write_root_wasm(repo_root)
        sync_wasm_assets(repo_root=repo_root)
        target = repo_root / NODE_WASM_ASSET.relative_path
        target.chmod(0o755)
        expect_exit_contains(lambda: check_wasm_assets(repo_root=repo_root), "must not be executable")

    with_temp_repo(run)


def test_generated_node_asset_uses_package_build_hint() -> None:
    def run(repo_root: Path) -> None:
        write_root_wasm(repo_root)
        expect_exit_contains(
            lambda: check_wasm_assets((NODE_WASM_ASSET,), repo_root=repo_root),
            "build_node_package.py",
        )

    with_temp_repo(run)


def main() -> int:
    tests = [
        test_sync_and_check_generated_asset,
        test_missing_root_wasm_fails,
        test_missing_target_fails,
        test_mismatch_fails,
        test_executable_target_fails,
        test_generated_node_asset_uses_package_build_hint,
    ]
    for test in tests:
        test()
    print("wasm assets ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
