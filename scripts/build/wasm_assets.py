from __future__ import annotations

import hashlib
import shutil
import stat
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
ROOT_WASM_RELATIVE = Path("dist/curl_parser.wasm")


@dataclass(frozen=True)
class WasmAsset:
    name: str
    relative_path: Path
    committed: bool
    package: str


NODE_WASM_ASSET = WasmAsset(
    name="node",
    relative_path=Path("packages/node/wasm/curl_parser.wasm"),
    committed=False,
    package="npm package",
)

GENERATED_PACKAGE_WASM_ASSETS = (NODE_WASM_ASSET,)


def root_wasm_path(repo_root: Path = REPO_ROOT) -> Path:
    return repo_root / ROOT_WASM_RELATIVE


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _display_path(path: Path, repo_root: Path) -> str:
    try:
        return path.relative_to(repo_root).as_posix()
    except ValueError:
        return path.as_posix()


def _repair_hint(asset: WasmAsset) -> str:
    return "python scripts/build/build_node_package.py"


def require_root_wasm(repo_root: Path = REPO_ROOT) -> Path:
    source = root_wasm_path(repo_root)
    if not source.is_file():
        raise SystemExit(
            f"{ROOT_WASM_RELATIVE.as_posix()} missing; "
            "run python scripts/tasks.py build-wasm"
        )
    return source


def copy_wasm_asset(
    asset: WasmAsset,
    *,
    repo_root: Path = REPO_ROOT,
) -> Path:
    source = require_root_wasm(repo_root)
    target = repo_root / asset.relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    target.chmod(0o644)
    return target


def sync_wasm_assets(
    assets: tuple[WasmAsset, ...] = GENERATED_PACKAGE_WASM_ASSETS,
    *,
    repo_root: Path = REPO_ROOT,
) -> list[Path]:
    return [copy_wasm_asset(asset, repo_root=repo_root) for asset in assets]


def check_wasm_assets(
    assets: tuple[WasmAsset, ...] = GENERATED_PACKAGE_WASM_ASSETS,
    *,
    repo_root: Path = REPO_ROOT,
) -> list[str]:
    source = require_root_wasm(repo_root)
    source_hash = sha256_file(source)
    source_size = source.stat().st_size
    errors: list[str] = []

    for asset in assets:
        target = repo_root / asset.relative_path
        display = _display_path(target, repo_root)
        if not target.is_file():
            errors.append(f"{display} missing; run {_repair_hint(asset)}")
            continue

        target_size = target.stat().st_size
        target_hash = sha256_file(target)
        if target_size != source_size or target_hash != source_hash:
            errors.append(
                f"{display} differs from {ROOT_WASM_RELATIVE.as_posix()} "
                f"(source {source_size} bytes {source_hash}, "
                f"target {target_size} bytes {target_hash}); "
                f"run {_repair_hint(asset)}"
            )

        if target.stat().st_mode & (stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH):
            errors.append(f"{display} must not be executable; run {_repair_hint(asset)}")

    if errors:
        raise SystemExit("wasm asset check failed:\n- " + "\n- ".join(errors))
    return [_display_path(repo_root / asset.relative_path, repo_root) for asset in assets]
