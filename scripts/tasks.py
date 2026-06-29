#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = REPO_ROOT / "config"
CURL_SOURCE = json.loads((CONFIG_DIR / "curl-source.json").read_text(encoding="utf-8"))
CURL_TAG = str(CURL_SOURCE["tag"])
CURL_VERSION = str(CURL_SOURCE["version"])
WASM_SIZE_BUDGET = int(CURL_SOURCE["wasmSizeBudget"])
CURL_ROOT = REPO_ROOT / "third_party" / "curl" / CURL_TAG
CORE_C_DIR = REPO_ROOT / "core" / "c"
CORE_C_SRC_DIR = CORE_C_DIR / "src"
GENERATED_DIR = REPO_ROOT / "build" / "generated"
GENERATED_HEADER_DIR = GENERATED_DIR / "include" / "curlparse" / "generated"
NATIVE_DIR = REPO_ROOT / "build" / "native"
DIST_DIR = REPO_ROOT / "dist"
WASM_PATH = DIST_DIR / "curl_parser.wasm"
NATIVE_CLI = NATIVE_DIR / "curlparse_cli"
NATIVE_LIB = NATIVE_DIR / "libcurlparse.so"
NODE_PACKAGE_DIR = REPO_ROOT / "packages" / "node"
WEB_PLAYGROUND_DIR = REPO_ROOT / "apps" / "web-playground"
GITHUB_NPM_TARBALL_LIMIT = 256 * 1024 * 1024
OWNED_TESTS = [
    ("abi_smoke_test", "core/c/tests/abi/abi_smoke_test.c"),
    ("curlparse_core_test", "core/c/tests/core/curlparse_core_test.c"),
    ("event_scan_test", "core/c/tests/capture/event_scan_test.c"),
    ("serialize_config_test", "core/c/tests/capture/serialize_config_test.c"),
    ("external_refs_test", "core/c/tests/io/external_refs_test.c"),
    ("profile_test", "core/c/tests/profile/default_profile_test.c"),
    ("libinfo_profile_test", "core/c/tests/profile/libinfo_profile_test.c"),
    ("profile_guard_test", "core/c/tests/profile-matrix/profile_guard_test.c"),
    ("stub_contract_test", "core/c/tests/runtime/stub_contract_test.c"),
]


def run(
    args: list[str],
    *,
    cwd: Path = REPO_ROOT,
    **kwargs: object,
) -> subprocess.CompletedProcess[str]:
    print("+", " ".join(shlex.quote(arg) for arg in args), flush=True)
    return subprocess.run(args, cwd=cwd, check=True, **kwargs)


def run_probe(args: list[str]) -> tuple[int, str]:
    try:
        completed = subprocess.run(
            args,
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
    except OSError as exc:
        return 127, str(exc)
    output = (completed.stdout or completed.stderr).strip().splitlines()
    return completed.returncode, output[0] if output else ""


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
        "core/c/src/runtime/curlparse_curl_compat.h",
        f"-Ithird_party/curl/{CURL_TAG}/include",
        f"-Ithird_party/curl/{CURL_TAG}/lib",
        f"-Ithird_party/curl/{CURL_TAG}/src",
        "-Icore/c/include",
        "-Icore/c/src",
        "-Ibuild/generated/include",
    ]


def native_link_flags() -> list[str]:
    return ["-Wl,--gc-sections", *shlex.split(os.environ.get("LDFLAGS", ""))]


def source_response_files() -> list[str]:
    return [
        "@build/generated/curlparse_sources.rsp",
        "@build/generated/minimal_curl_support.rsp",
    ]


def version_tuple(text: str) -> tuple[int, int, int] | None:
    match = re.search(r"([0-9]+)\.([0-9]+)(?:\.([0-9]+))?", text)
    if not match:
        return None
    patch = match.group(3) or "0"
    return int(match.group(1)), int(match.group(2)), int(patch)


def check_min_version(version: str, minimum: tuple[int, int, int]) -> bool:
    parsed = version_tuple(version)
    return parsed is not None and parsed >= minimum


def resolve_tool(command: list[str]) -> str:
    if not command:
        return ""
    resolved = shutil.which(command[0])
    if resolved:
        return resolved
    candidate = Path(command[0])
    if candidate.exists():
        return str(candidate)
    return ""


def print_doctor(rows: list[dict[str, str]]) -> None:
    headers = ["tool", "resolved path", "version", "required range", "status", "fix hint"]
    widths = {
        header: max(len(header), *(len(row[header]) for row in rows))
        for header in headers
    }
    print(" | ".join(header.ljust(widths[header]) for header in headers))
    print(" | ".join("-" * widths[header] for header in headers))
    for row in rows:
        print(" | ".join(row[header].ljust(widths[header]) for header in headers))


def doctor(_args: argparse.Namespace) -> None:
    rows: list[dict[str, str]] = []

    def add_row(
        tool: str,
        resolved: str,
        version: str,
        required: str,
        status: str,
        hint: str,
    ) -> None:
        rows.append({
            "tool": tool,
            "resolved path": resolved or "-",
            "version": version or "-",
            "required range": required,
            "status": status,
            "fix hint": hint or "-",
        })

    python_version = ".".join(str(part) for part in sys.version_info[:3])
    add_row(
        "python",
        sys.executable,
        python_version,
        ">=3.10",
        "ok" if sys.version_info >= (3, 10) else "fail",
        "install Python 3.10 or newer",
    )

    node_path = resolve_tool(["node"])
    node_rc, node_version = run_probe(["node", "--version"]) if node_path else (127, "")
    add_row(
        "node",
        node_path,
        node_version,
        ">=20",
        "ok" if node_rc == 0 and check_min_version(node_version, (20, 0, 0)) else "fail",
        "install Node.js 20 or newer",
    )

    tsc_path = resolve_tool(["tsc"])
    tsc_rc, tsc_version = run_probe(["tsc", "--version"]) if tsc_path else (127, "")
    add_row(
        "tsc",
        tsc_path,
        tsc_version,
        "TypeScript compiler",
        "ok" if tsc_rc == 0 else "fail",
        "install TypeScript",
    )

    git_path = resolve_tool(["git"])
    git_rc, git_version = run_probe(["git", "--version"]) if git_path else (127, "")
    add_row(
        "git",
        git_path,
        git_version,
        "present",
        "ok" if git_rc == 0 else "fail",
        "install git",
    )

    cc_command = cc()
    cc_path = resolve_tool(cc_command)
    cc_rc, cc_version = run_probe([*cc_command, "--version"]) if cc_path else (127, "")
    add_row(
        "CC",
        cc_path,
        cc_version,
        "C99 compiler",
        "ok" if cc_rc == 0 else "fail",
        "install zig or clang, or set CC",
    )

    wasm_command = wasm_cc()
    wasm_path = resolve_tool(wasm_command)
    wasm_rc, wasm_version = (
        run_probe([*wasm_command, "-target", "wasm32-wasi", "--version"])
        if wasm_path else (127, "")
    )
    add_row(
        "WASM_CC",
        wasm_path,
        wasm_version,
        "wasm32-wasi C compiler",
        "ok" if wasm_rc == 0 else "fail",
        "install zig or a WASI-capable clang, or set WASM_CC",
    )

    curl_manifest = CURL_ROOT / "manifest.json"
    curl_version = "missing"
    if curl_manifest.is_file():
        try:
            curl_version = json.loads(curl_manifest.read_text(encoding="utf-8")).get(
                "tag",
                CURL_TAG,
            )
        except json.JSONDecodeError:
            curl_version = "invalid manifest"
    add_row(
        "curl source",
        str(curl_manifest),
        curl_version,
        CURL_TAG,
        "ok" if curl_manifest.is_file() and curl_version != "invalid manifest" else "warn",
        "run python scripts/tasks.py bootstrap",
    )

    generated_required = [
        GENERATED_DIR / "curlparse_sources.rsp",
        GENERATED_DIR / "minimal_curl_support.rsp",
        GENERATED_HEADER_DIR / "curlparse_guards.h",
        GENERATED_HEADER_DIR / "curlparse_stub_contracts.h",
    ]
    missing_generated = [path for path in generated_required if not path.exists()]
    add_row(
        "generated inputs",
        "build/generated",
        "ready" if not missing_generated else "missing",
        f"generated for curl {CURL_VERSION}",
        "ok" if not missing_generated else "warn",
        "run python scripts/tasks.py generate",
    )

    print_doctor(rows)

    if any(row["status"] == "fail" for row in rows):
        raise SystemExit(1)


def ensure_generated_inputs() -> None:
    required = [
        GENERATED_DIR / "curlparse_sources.rsp",
        GENERATED_DIR / "minimal_curl_support.rsp",
        GENERATED_HEADER_DIR / "curlparse_guards.h",
        GENERATED_HEADER_DIR / "curlparse_stub_contracts.h",
    ]
    missing = [path for path in required if not path.exists()]
    if missing:
        names = ", ".join(path.as_posix() for path in missing)
        raise SystemExit(f"generated files missing: {names}; run scripts/tasks.py generate")


def bootstrap(_args: argparse.Namespace) -> None:
    if (CURL_ROOT / "manifest.json").is_file():
        print(f"{CURL_ROOT.relative_to(REPO_ROOT)} already exists")
        return
    run(["python", "scripts/curl/vendor_curl.py", "--tag", CURL_TAG])


def generate(_args: argparse.Namespace) -> None:
    if not CURL_ROOT.exists():
        raise SystemExit("curl source missing; run scripts/tasks.py bootstrap")

    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    GENERATED_HEADER_DIR.mkdir(parents=True, exist_ok=True)
    run([
        "python",
        "scripts/curl/extract_source_inventory.py",
        "--curl-root",
        f"third_party/curl/{CURL_TAG}",
        "--out",
        f"build/generated/source-inventory-{CURL_VERSION}.json",
        "--rsp",
        "build/generated/curlparse_sources.rsp",
    ])
    run([
        "python",
        "scripts/curl/extract_option_catalog.py",
        "--curl-root",
        f"third_party/curl/{CURL_TAG}",
        "--out",
        f"build/generated/options-{CURL_VERSION}.json",
    ])
    run([
        "python",
        "scripts/build/build_guard_table.py",
        "--options",
        f"build/generated/options-{CURL_VERSION}.json",
        "--out",
        f"build/generated/guards-{CURL_VERSION}.json",
        "--header",
        "build/generated/include/curlparse/generated/curlparse_guards.h",
    ])
    run([
        "python",
        "scripts/build/build_stub_contracts.py",
        "--contracts",
        "core/c/src/runtime/stub-contracts.json",
        "--header",
        "build/generated/include/curlparse/generated/curlparse_stub_contracts.h",
    ])
    (GENERATED_DIR / "minimal_curl_support.rsp").write_text(
        "core/c/src/runtime/curlparse_minimal_support.c\n",
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
        "core/c/src/tools/curlparse_cli.c",
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
        "core/c/src/runtime/curlparse_curl_compat.h",
        f"-Ithird_party/curl/{CURL_TAG}/include",
        f"-Ithird_party/curl/{CURL_TAG}/lib",
        f"-Ithird_party/curl/{CURL_TAG}/src",
        "-Icore/c/include",
        "-Icore/c/src",
        "-Ibuild/generated/include",
        "-Wl,--export-memory",
        "-Wl,--export=curlparse_abi_version",
        "-Wl,--export=curlparse_alloc",
        "-Wl,--export=curlparse_free",
        "-Wl,--export=curlparse_buf_free",
        "-Wl,--export=curlparse_engine_new",
        "-Wl,--export=curlparse_engine_free",
        "-Wl,--export=curlparse_parse_json",
        "-Wl,--export=curlparse_generate_json",
        *shlex.split(os.environ.get("WASM_LDFLAGS", "")),
        "-o",
        str(WASM_PATH),
        *source_response_files(),
    ])


def build_web(_args: argparse.Namespace) -> None:
    web_playground_build()


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


def web_playground_install() -> None:
    if os.environ.get("CURL_PARSER_SKIP_WEB_NPM_CI") == "1":
        return
    run(["npm", "--prefix", "apps/web-playground", "ci"])


def web_playground_build() -> None:
    if not WASM_PATH.exists():
        build_wasm(argparse.Namespace())
    web_playground_install()
    run(["npm", "--prefix", "apps/web-playground", "run", "build"])


def lint(_args: argparse.Namespace) -> None:
    if not WASM_PATH.exists():
        build_wasm(argparse.Namespace())
    run(["python", "scripts/build/build_node_package.py"])
    web_playground_build()
    run(["python", "-m", "compileall", "scripts", "tests"])
    for script in sorted((NODE_PACKAGE_DIR / "dist").glob("*.js")):
        run(["node", "--check", script.relative_to(REPO_ROOT).as_posix()])
    run(["tsc", "-p", "packages/node/test/types/tsconfig.json"])
    run(["node", "--check", "tests/js/test_shell_parser.mjs"])
    run(["node", "--check", "tests/js/test_node_package.mjs"])
    run(["node", "--check", "tests/js/test_libcurl_generator.mjs"])
    run(["node", "--check", "tests/js/test_python_requests_generator.mjs"])
    run(["node", "--check", "tests/js/test_javascript_generators.mjs"])
    run(["node", "--check", "tests/js/test_generated_code_no_tabs.mjs"])
    run(["node", "--check", "tests/js/test_go_generator.mjs"])
    run(["node", "--check", "tests/js/test_rust_generator.mjs"])
    run(["node", "--check", "tests/js/test_cli.mjs"])
    run(["node", "--check", "tests/js/test_web_playground.mjs"])
    run(["node", "--check", "tests/js/test_fixture_contracts.mjs"])
    for schema in sorted((REPO_ROOT / "schemas").glob("*.json")):
        run(["python", "-m", "json.tool", schema.as_posix()], stdout=subprocess.DEVNULL)
    for capability in sorted((REPO_ROOT / "generators" / "capabilities").glob("*.json")):
        run(["python", "-m", "json.tool", capability.as_posix()], stdout=subprocess.DEVNULL)
    run(["python", "scripts/release/validate_contracts.py"])


def test(_args: argparse.Namespace) -> None:
    build_tests(argparse.Namespace())
    for name, _source in OWNED_TESTS:
        run([str(NATIVE_DIR / name)])
    run(["python", "tests/integration/run_golden.py"])
    run(["python", "tests/contracts/test_ir_contract.py"])
    run(["python", "tests/contracts/test_stub_contracts.py"])
    run(["python", "tests/integration/run_native_vs_wasm.py"])
    run(["python", "tests/integration/run_fuzz.py", "--cases", os.environ.get("FUZZ_CASES", "1000")])
    run(["python", "scripts/build/build_node_package.py"])
    run(["python", "tests/python/test_wasm_assets.py"])
    run(["node", "tests/js/test_shell_parser.mjs"])
    run(["node", "tests/js/test_node_package.mjs"])
    run(["python", "tests/python/test_request_plan.py"])
    run(["node", "tests/js/test_libcurl_generator.mjs"])
    run(["node", "tests/js/test_python_requests_generator.mjs"])
    run(["node", "tests/js/test_javascript_generators.mjs"])
    run(["node", "tests/js/test_generated_code_no_tabs.mjs"])
    run(["node", "tests/js/test_go_generator.mjs"])
    run(["node", "tests/js/test_rust_generator.mjs"])
    run(["node", "tests/js/test_cli.mjs"])
    web_playground_build()
    run(["node", "tests/js/test_web_playground.mjs"])
    run(["node", "tests/js/test_fixture_contracts.mjs"])


def pack_node(_args: argparse.Namespace) -> None:
    if not WASM_PATH.exists():
        build_wasm(argparse.Namespace())
    run(["python", "scripts/build/build_node_package.py"])
    completed = run(
        ["npm", "pack", "--dry-run", "--json"],
        cwd=NODE_PACKAGE_DIR,
        text=True,
        capture_output=True,
    )
    packs = json.loads(completed.stdout)
    if not packs:
        raise SystemExit("npm pack produced no package metadata")

    package = packs[0]
    package_size = int(package["size"])
    print(f"package: {package['name']}@{package['version']}")
    print(f"tarball: {package['filename']}")
    print(f"tarball size: {package_size} bytes")
    print(f"tarball limit: {GITHUB_NPM_TARBALL_LIMIT} bytes")
    if package_size >= GITHUB_NPM_TARBALL_LIMIT:
        raise SystemExit(
            f"npm tarball {package_size} exceeds GitHub Packages limit "
            f"{GITHUB_NPM_TARBALL_LIMIT}"
        )

    print("files:")
    for item in package["files"]:
        print(f"  {item['path']} {item['size']} bytes")


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
    doctor(argparse.Namespace())
    bootstrap(argparse.Namespace())
    generate(argparse.Namespace())
    build_native(argparse.Namespace())
    build_wasm(argparse.Namespace())
    lint(argparse.Namespace())
    test(argparse.Namespace())
    size(argparse.Namespace(budget=WASM_SIZE_BUDGET))


def release_check(_args: argparse.Namespace) -> None:
    doctor(argparse.Namespace())
    generate(argparse.Namespace())
    build_native(argparse.Namespace())
    build_native_shared(argparse.Namespace())
    build_wasm(argparse.Namespace())
    lint(argparse.Namespace())
    test(argparse.Namespace())
    size(argparse.Namespace(budget=WASM_SIZE_BUDGET))
    run(["python", "scripts/release/generate_third_party_notices.py"])
    pack_node(argparse.Namespace())


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
        "doctor": doctor,
        "bootstrap": bootstrap,
        "generate": generate,
        "build-native": build_native,
        "build-native-shared": build_native_shared,
        "build-wasm": build_wasm,
        "build-web": build_web,
        "build-tests": build_tests,
        "lint": lint,
        "test": test,
        "pack-node": pack_node,
        "release-check": release_check,
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
