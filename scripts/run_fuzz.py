#!/usr/bin/env python3
from __future__ import annotations

import argparse
import ctypes
import json
import os
import random
import string
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
SEED_PATH = REPO_ROOT / "tests" / "fuzz" / "seed.json"
OPTIONS_PATH = REPO_ROOT / "build" / "generated" / "options-8.20.0.json"
NATIVE_LIB = REPO_ROOT / "build" / "native" / "libcurlparse.so"
VENV_PYTHON = REPO_ROOT / ".venv" / "bin" / "python"
OUTPUT_LIMIT = 4 * 1024 * 1024
TIMEOUT_SECONDS = 2.0


def ensure_venv_python() -> None:
    try:
        import wasmtime  # noqa: F401
    except ImportError:
        if VENV_PYTHON.exists() and Path(sys.executable) != VENV_PYTHON:
            completed = subprocess.run(
                [str(VENV_PYTHON), str(Path(__file__)), *sys.argv[1:]],
                cwd=REPO_ROOT,
                check=False,
            )
            raise SystemExit(completed.returncode)
        raise


ensure_venv_python()


def add_python_wrapper_path() -> None:
    wrapper_dir = str((REPO_ROOT / "wrappers" / "python").resolve())
    if wrapper_dir not in sys.path:
        sys.path.insert(0, wrapper_dir)


add_python_wrapper_path()

from curl_parser_wasm import CurlParserWasm  # type: ignore  # noqa: E402


def canonicalize(text: str) -> str:
    return json.dumps(
        json.loads(text),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )


class NativeParser:
    def __init__(self, lib_path: Path):
        self.lib = ctypes.CDLL(str(lib_path))
        self.lib.curlparse_parse_native_json.argtypes = [
            ctypes.c_char_p,
            ctypes.POINTER(ctypes.c_void_p),
            ctypes.POINTER(ctypes.c_size_t),
        ]
        self.lib.curlparse_parse_native_json.restype = ctypes.c_int
        self.libc = ctypes.CDLL(None)
        self.libc.free.argtypes = [ctypes.c_void_p]
        self.libc.free.restype = None

    def parse(self, input_obj: dict[str, Any]) -> str:
        payload = json.dumps(
            input_obj,
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode("utf-8")
        out_ptr = ctypes.c_void_p()
        out_len = ctypes.c_size_t()
        rc = self.lib.curlparse_parse_native_json(
            payload,
            ctypes.byref(out_ptr),
            ctypes.byref(out_len),
        )
        if rc != 0:
            raise RuntimeError(f"native parse failed: {rc}")

        try:
            data = ctypes.string_at(out_ptr, out_len.value).decode("utf-8")
        finally:
            self.libc.free(out_ptr)

        return data


def build_native_shared() -> None:
    subprocess.run(
        ["python", "scripts/tasks.py", "build-native-shared"],
        cwd=REPO_ROOT,
        check=True,
    )


def build_wasm() -> None:
    subprocess.run(
        ["python", "scripts/tasks.py", "build-wasm"],
        cwd=REPO_ROOT,
        check=True,
    )


def load_seed() -> dict[str, Any]:
    return json.loads(SEED_PATH.read_text(encoding="utf-8"))


def load_options() -> list[dict[str, Any]]:
    payload = json.loads(OPTIONS_PATH.read_text(encoding="utf-8"))
    return payload["options"]


def random_identifier(rng: random.Random, prefix: str) -> str:
    suffix = "".join(rng.choice(string.ascii_lowercase) for _ in range(6))
    return f"{prefix}{suffix}"


def random_url(rng: random.Random, scheme: str | None = None) -> str:
    chosen_scheme = scheme or rng.choice(["http", "https", "ftp", "sftp", "madeup"])
    return f"{chosen_scheme}://{random_identifier(rng, 'host')}.example/path"


def choose_value(rng: random.Random, arg_type: str) -> str:
    if arg_type == "seconds":
        return str(rng.randint(0, 30))
    if arg_type == "unsigned":
        return str(rng.randint(0, 1000))
    return rng.choice(
        [
            "value",
            "A: B",
            "a=1",
            "https://proxy.example",
            "curl/8.20.0",
        ]
    )


def generate_runtime_profile(
    rng: random.Random,
    seed: dict[str, Any],
) -> dict[str, Any]:
    protocols = seed["protocols"][:]
    features = seed["features"][:]
    rng.shuffle(protocols)
    rng.shuffle(features)
    protocol_count = rng.randint(2, min(6, len(protocols)))
    feature_count = rng.randint(2, min(6, len(features)))
    return {
        "curlVersion": "8.20.0",
        "protocols": sorted(protocols[:protocol_count]),
        "features": sorted(features[:feature_count]),
        "compile": {
            "availableOptions": None,
            "disabledOptions": [],
            "defines": [],
        },
    }


def generate_case(
    rng: random.Random,
    seed: dict[str, Any],
    options: list[dict[str, Any]],
) -> dict[str, Any]:
    safe_long_values = [
        {"long": "data", "argType": "string"},
        {"long": "header", "argType": "string"},
        {"long": "user-agent", "argType": "string"},
        {"long": "request", "argType": "string"},
        {"long": "connect-timeout", "argType": "seconds"},
        {"long": "max-time", "argType": "seconds"},
        {"long": "retry", "argType": "unsigned"},
    ]
    safe_short_value_map = {
        "data": None,
        "header": "H",
        "user-agent": "A",
        "request": "X",
        "connect-timeout": None,
        "max-time": "m",
        "retry": None,
    }
    safe_long_flags = ["http2", "http3", "location", "verbose", "silent"]
    safe_short_flags = ["L", "v", "s", "I"]
    no_bool_options = ["progress-meter"]

    pattern = rng.choice(
        [
            "long",
            "long_equals",
            "short",
            "bundle",
            "missing_arg",
            "unknown",
            "no_bool",
            "next",
            "proto",
            "proto_default",
            "random_scheme",
        ]
    )

    argv = ["curl"]
    if pattern == "long":
        option = rng.choice(safe_long_values)
        argv.extend([f"--{option['long']}", choose_value(rng, option["argType"])])
    elif pattern == "long_equals":
        option = rng.choice(safe_long_values)
        argv.append(f"--{option['long']}={choose_value(rng, option['argType'])}")
    elif pattern == "short":
        option = rng.choice(safe_long_values)
        short_name = safe_short_value_map[option["long"]]
        if short_name:
            argv.extend([f"-{short_name}", choose_value(rng, option["argType"])])
        else:
            argv.extend([f"--{option['long']}", choose_value(rng, option["argType"])])
    elif pattern == "bundle":
        bundle = "".join(rng.sample(safe_short_flags, min(3, len(safe_short_flags))))
        argv.append(f"-{bundle}")
    elif pattern == "missing_arg":
        option = rng.choice(safe_long_values)
        argv.append(f"--{option['long']}")
    elif pattern == "unknown":
        argv.append(f"--{random_identifier(rng, 'unknown-')}")
    elif pattern == "no_bool":
        argv.append(f"--no-{rng.choice(no_bool_options)}")
    elif pattern == "next":
        argv.extend([random_url(rng, "https"), "--next", random_url(rng, "https")])
    elif pattern == "proto":
        argv.extend(["--proto", rng.choice(["-madeup", "+http,-madeup", "=https,-ftp"])])
    elif pattern == "proto_default":
        argv.extend(["--proto-default", rng.choice(["sftp", "https", "madeup"]), "example.com"])
    elif pattern == "random_scheme":
        argv.append(random_url(rng))

    if pattern not in {"next", "proto_default", "random_scheme"}:
        argv.append(random_url(rng, rng.choice(["http", "https", "sftp", "madeup"])))

    input_obj = {
        "inputMode": "argv",
        "argv": argv[:200],
        "parseMode": rng.choice(["strict", "diagnostic"]),
        "runtimeProfile": generate_runtime_profile(rng, seed),
        "options": {
            "loadDefaultCurlrc": False,
            "allowHostFileRead": False,
            "virtualFiles": {},
        },
    }
    return input_obj


class SuppressFd2:
    def __enter__(self) -> None:
        self.saved_fd = os.dup(2)
        self.devnull_fd = os.open(os.devnull, os.O_WRONLY)
        os.dup2(self.devnull_fd, 2)

    def __exit__(self, exc_type, exc, tb) -> None:
        os.dup2(self.saved_fd, 2)
        os.close(self.saved_fd)
        os.close(self.devnull_fd)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cases", type=int, default=10000)
    args = parser.parse_args()

    build_native_shared()
    build_wasm()

    seed = load_seed()
    options = load_options()
    rng = random.Random(seed["seed"])

    native = NativeParser(NATIVE_LIB)
    wasm = CurlParserWasm(REPO_ROOT / "dist" / "curl_parser.wasm")

    crash = 0
    timeout = 0
    mismatch = 0
    invalid_json = 0

    for _ in range(args.cases):
        case_input = generate_case(rng, seed, options)
        started = time.monotonic()

        try:
            with SuppressFd2():
                native_output = native.parse(case_input)
            wasm_output = json.dumps(
                wasm.parse(case_input),
                separators=(",", ":"),
                ensure_ascii=False,
            )
        except Exception:
            crash += 1
            continue

        elapsed = time.monotonic() - started
        if elapsed > TIMEOUT_SECONDS:
            timeout += 1
            continue

        if len(native_output) > OUTPUT_LIMIT or len(wasm_output) > OUTPUT_LIMIT:
            invalid_json += 1
            continue

        try:
            native_json = canonicalize(native_output)
            wasm_json = canonicalize(wasm_output)
        except Exception:
            invalid_json += 1
            continue

        if native_json != wasm_json:
            mismatch += 1

    print(f"crash: {crash}")
    print(f"timeout: {timeout}")
    print(f"native-vs-wasm mismatch: {mismatch}")
    print(f"invalid-json-output: {invalid_json}")

    if crash or timeout or mismatch or invalid_json:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
