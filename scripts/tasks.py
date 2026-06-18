#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shlex
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
CURL_TAG = "curl-8_20_0"
CURL_VERSION = "8.20.0"
CURL_ROOT = REPO_ROOT / "third_party" / "curl" / CURL_TAG
NATIVE_DIR = REPO_ROOT / "build" / "native"
GENERATED_DIR = REPO_ROOT / "build" / "generated"
DIST_DIR = REPO_ROOT / "dist"
WASM_PATH = DIST_DIR / "curl_parser.wasm"
NATIVE_CLI = NATIVE_DIR / "curlparse_cli"
NATIVE_LIB = NATIVE_DIR / "libcurlparse.so"


OWNED_TESTS = [
    ("abi_smoke_test", "tests/abi/abi_smoke_test.c"),
    ("curlparse_core_test", "tests/core/curlparse_core_test.c"),
    ("event_scan_test", "tests/capture/event_scan_test.c"),
    ("serialize_config_test", "tests/capture/serialize_config_test.c"),
    ("virtual_files_test", "tests/io/virtual_files_test.c"),
    ("profile_test", "tests/profile/default_profile_test.c"),
    ("libinfo_profile_test", "tests/profile/libinfo_profile_test.c"),
    ("profile_guard_test", "tests/profile-matrix/profile_guard_test.c"),
]


def run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
    print("+", " ".join(shlex.quote(arg) for arg in args), flush=True)
    return subprocess.run(args, cwd=REPO_ROOT, check=True, **kwargs)


def split_env(name: str, default: str) -> list[str]:
    return shlex.split(os.environ.get(name, default))


def cc() -> list[str]:
    return split_env("CC", "zig cc")


def wasm_cc() -> list[str]:
    return split_env("WASM_CC", "zig cc")


def common_cflags() -> list[str]:
    return [
        "-std=c99",
        *shlex.split(os.environ.get("CFLAGS", "")),
        "-ffunction-sections",
        "-fdata-sections",
        "-DUNITTESTS=1",
        "-DCURLPARSE_NATIVE=1",
        "-include",
        "src/runtime/curlparse_curl_compat.h",
        "-Ithird_party/curl/curl-8_20_0/include",
        "-Ithird_party/curl/curl-8_20_0/lib",
        "-Ithird_party/curl/curl-8_20_0/src",
        "-Isrc",
    ]


def native_link_flags() -> list[str]:
    return ["-Wl,--gc-sections", *shlex.split(os.environ.get("LDFLAGS", ""))]


def source_response_files() -> list[str]:
    return [
        "@build/generated/curlparse_sources.rsp",
        "@build/generated/minimal_curl_support.rsp",
    ]


def ensure_generated_inputs() -> None:
    required = [
        GENERATED_DIR / "curlparse_sources.rsp",
        GENERATED_DIR / "minimal_curl_support.rsp",
        REPO_ROOT / "src" / "generated" / "curlparse_guards_8_20_0.h",
    ]
    missing = [path for path in required if not path.exists()]
    if missing:
        names = ", ".join(path.as_posix() for path in missing)
        raise SystemExit(f"generated files missing: {names}; run scripts/tasks.py generate")


def bootstrap(_args: argparse.Namespace) -> None:
    if (CURL_ROOT / "manifest.json").is_file():
        print(f"{CURL_ROOT.relative_to(REPO_ROOT)} already exists")
        return
    run(["python", "scripts/vendor_curl.py", "--tag", CURL_TAG])


def generate(_args: argparse.Namespace) -> None:
    if not CURL_ROOT.exists():
        raise SystemExit("curl source missing; run scripts/tasks.py bootstrap")

    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    run([
        "python",
        "scripts/extract_source_inventory.py",
        "--curl-root",
        f"third_party/curl/{CURL_TAG}",
        "--out",
        f"build/generated/source-inventory-{CURL_VERSION}.json",
        "--rsp",
        "build/generated/curlparse_sources.rsp",
    ])
    run([
        "python",
        "scripts/extract_option_catalog.py",
        "--curl-root",
        f"third_party/curl/{CURL_TAG}",
        "--out",
        f"build/generated/options-{CURL_VERSION}.json",
    ])
    run([
        "python",
        "scripts/build_guard_table.py",
        "--options",
        f"build/generated/options-{CURL_VERSION}.json",
        "--out",
        f"build/generated/guards-{CURL_VERSION}.json",
        "--header",
        "src/generated/curlparse_guards_8_20_0.h",
    ])
    (GENERATED_DIR / "minimal_curl_support.rsp").write_text(
        "src/runtime/curlparse_minimal_support.c\n",
        encoding="utf-8",
    )


def build_native(_args: argparse.Namespace) -> None:
    ensure_generated_inputs()
    NATIVE_DIR.mkdir(parents=True, exist_ok=True)
    run([
        *cc(),
        *common_cflags(),
        "-O0",
        "-g",
        *native_link_flags(),
        "-o",
        str(NATIVE_CLI),
        *source_response_files(),
        "src/tools/curlparse_cli.c",
    ])


def build_native_shared(_args: argparse.Namespace) -> None:
    ensure_generated_inputs()
    NATIVE_DIR.mkdir(parents=True, exist_ok=True)
    run([
        *cc(),
        "-shared",
        "-fPIC",
        *common_cflags(),
        "-O0",
        "-g",
        *native_link_flags(),
        "-o",
        str(NATIVE_LIB),
        *source_response_files(),
    ])


def build_wasm(_args: argparse.Namespace) -> None:
    ensure_generated_inputs()
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    run([
        *wasm_cc(),
        "-target",
        "wasm32-wasi",
        "-mexec-model=reactor",
        "-std=c99",
        "-Oz",
        "-flto",
        *shlex.split(os.environ.get("WASM_CFLAGS", "")),
        "-ffunction-sections",
        "-fdata-sections",
        "-Wl,--gc-sections",
        "-DCURLPARSE_WASM=1",
        "-include",
        "src/runtime/curlparse_curl_compat.h",
        "-Ithird_party/curl/curl-8_20_0/include",
        "-Ithird_party/curl/curl-8_20_0/lib",
        "-Ithird_party/curl/curl-8_20_0/src",
        "-Isrc",
        "-Wl,--export-memory",
        "-Wl,--export=curlparse_abi_version",
        "-Wl,--export=curlparse_alloc",
        "-Wl,--export=curlparse_free",
        "-Wl,--export=curlparse_parse",
        *shlex.split(os.environ.get("WASM_LDFLAGS", "")),
        "-o",
        str(WASM_PATH),
        *source_response_files(),
    ])


def build_tests(_args: argparse.Namespace) -> None:
    ensure_generated_inputs()
    NATIVE_DIR.mkdir(parents=True, exist_ok=True)
    for name, source in OWNED_TESTS:
        run([
            *cc(),
            *common_cflags(),
            "-O0",
            "-g",
            *native_link_flags(),
            "-o",
            str(NATIVE_DIR / name),
            source,
            *source_response_files(),
        ])


def lint(_args: argparse.Namespace) -> None:
    run(["python", "-m", "compileall", "scripts", "wrappers/python"])
    run(["node", "--check", "wrappers/node/index.mjs"])
    run(["node", "--check", "wrappers/node/example.mjs"])
    for schema in sorted((REPO_ROOT / "schemas").glob("*.json")):
        run(["python", "-m", "json.tool", schema.as_posix()], stdout=subprocess.DEVNULL)


def test(_args: argparse.Namespace) -> None:
    build_tests(argparse.Namespace())
    for name, _source in OWNED_TESTS:
        run([str(NATIVE_DIR / name)])
    run(["python", "scripts/run_golden.py"])
    run(["python", "scripts/run_native_vs_wasm.py"])
    run(["python", "scripts/run_fuzz.py", "--cases", os.environ.get("FUZZ_CASES", "1000")])
    run(["node", "wrappers/node/example.mjs"], stdout=subprocess.DEVNULL)
    run(["python", "wrappers/python/example.py"], stdout=subprocess.DEVNULL)


def wasm_sections(path: Path) -> list[tuple[int, str, int]]:
    data = path.read_bytes()
    names = {
        0: "custom",
        1: "type",
        2: "import",
        3: "function",
        4: "table",
        5: "memory",
        6: "global",
        7: "export",
        8: "start",
        9: "element",
        10: "code",
        11: "data",
        12: "data_count",
    }
    offset = 8
    sections: list[tuple[int, str, int]] = []
    while offset < len(data):
        section_id = data[offset]
        offset += 1
        shift = 0
        size = 0
        while True:
            byte = data[offset]
            offset += 1
            size |= (byte & 0x7F) << shift
            if not byte & 0x80:
                break
            shift += 7
        label = names.get(section_id, str(section_id))
        sections.append((section_id, label, size))
        offset += size
    return sections


def size(args: argparse.Namespace) -> None:
    if not WASM_PATH.exists():
        build_wasm(argparse.Namespace())
    total = WASM_PATH.stat().st_size
    print(f"{WASM_PATH.relative_to(REPO_ROOT)} {total} bytes")
    for section_id, label, section_size in wasm_sections(WASM_PATH):
        print(f"{section_id:2} {label:12} {section_size:7} bytes")
    if args.budget is not None and total > args.budget:
        raise SystemExit(f"wasm size {total} exceeds budget {args.budget}")


def ci(_args: argparse.Namespace) -> None:
    bootstrap(argparse.Namespace())
    generate(argparse.Namespace())
    lint(argparse.Namespace())
    build_native(argparse.Namespace())
    build_wasm(argparse.Namespace())
    test(argparse.Namespace())
    size(argparse.Namespace(budget=110000))


def release(_args: argparse.Namespace) -> None:
    ci(argparse.Namespace())
    digest = hashlib.sha256(WASM_PATH.read_bytes()).hexdigest()
    (DIST_DIR / "curl_parser.wasm.sha256").write_text(
        f"{digest}  curl_parser.wasm\n",
        encoding="utf-8",
    )
    print(f"sha256 {digest}")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    commands = {
        "bootstrap": bootstrap,
        "generate": generate,
        "build-native": build_native,
        "build-native-shared": build_native_shared,
        "build-wasm": build_wasm,
        "build-tests": build_tests,
        "lint": lint,
        "test": test,
        "ci": ci,
        "release": release,
    }
    for name, func in commands.items():
        subparser = subparsers.add_parser(name)
        subparser.set_defaults(func=func)
    size_parser = subparsers.add_parser("size")
    size_parser.add_argument("--budget", type=int)
    size_parser.set_defaults(func=size)

    args = parser.parse_args(argv)
    args.func(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
