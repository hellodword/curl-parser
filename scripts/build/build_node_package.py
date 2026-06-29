#!/usr/bin/env python3
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from wasm_assets import NODE_WASM_ASSET, check_wasm_assets, copy_wasm_asset, require_root_wasm


REPO_ROOT = Path(__file__).resolve().parents[2]
PACKAGE_ROOT = REPO_ROOT / "packages" / "node"


def copy_tree(source: Path, target: Path) -> None:
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(source, target)


def main() -> int:
    require_root_wasm(REPO_ROOT)

    dist = PACKAGE_ROOT / "dist"
    if dist.exists():
        shutil.rmtree(dist)

    copy_tree(REPO_ROOT / "schemas", PACKAGE_ROOT / "schemas")
    copy_wasm_asset(NODE_WASM_ASSET, repo_root=REPO_ROOT)
    check_wasm_assets((NODE_WASM_ASSET,), repo_root=REPO_ROOT)
    shutil.copy2(REPO_ROOT / "LICENSE", PACKAGE_ROOT / "LICENSE")

    subprocess.run(["tsc", "-p", "packages/node/tsconfig.json"], cwd=REPO_ROOT, check=True)
    (PACKAGE_ROOT / "dist" / "cli.js").chmod(0o755)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
