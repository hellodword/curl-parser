#!/usr/bin/env python3
from __future__ import annotations

import argparse
import ctypes
import json
import os
import random
import string
import subprocess
import time
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
CURL_SOURCE = json.loads((REPO_ROOT / "config" / "curl-source.json").read_text(encoding="utf-8"))
CURL_VERSION = str(CURL_SOURCE["version"])
SEED_PATH = REPO_ROOT / "fixtures" / "fuzz" / "seed.json"
OPTIONS_PATH = REPO_ROOT / "build" / "generated" / f"options-{CURL_VERSION}.json"
NATIVE_LIB = REPO_ROOT / "build" / "native" / "libcurlparse.so"
OUTPUT_LIMIT = 4 * 1024 * 1024
TIMEOUT_SECONDS = 2.0

NODE_SNIPPET = """
import readline from "node:readline";
import { createParser } from "./packages/node/dist/node.js";

const parser = await createParser();
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

try {
  for await (const line of rl) {
    if (!line) {
      continue;
    }
    try {
      const input = JSON.parse(line);
      const output = await parser.parseCurl(input);
      process.stdout.write(`${JSON.stringify({ ok: true, output })}\\n`);
    } catch (error) {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.stack ?? error.message : String(error),
      })}\\n`);
    }
  }
} finally {
  parser.dispose();
}
"""


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


class NodeWasmParser:
    def __init__(self) -> None:
        self.process = subprocess.Popen(
            ["node", "--input-type=module", "-e", NODE_SNIPPET],
            cwd=REPO_ROOT,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1,
        )

    def parse(self, input_obj: dict[str, Any]) -> str:
        if self.process.poll() is not None:
            raise RuntimeError(f"node wasm parser exited: {self.process.returncode}")
        if self.process.stdin is None or self.process.stdout is None:
            raise RuntimeError("node wasm parser pipes are unavailable")

        payload = json.dumps(input_obj, separators=(",", ":"), ensure_ascii=False)
        self.process.stdin.write(payload + "\n")
        self.process.stdin.flush()

        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError("node wasm parser produced no output")

        response = json.loads(line)
        if not response.get("ok"):
            raise RuntimeError(str(response.get("error", "node wasm parse failed")))
        return json.dumps(response["output"], separators=(",", ":"), ensure_ascii=False)

    def close(self) -> None:
        if self.process.stdin is not None:
            try:
                self.process.stdin.close()
            except OSError:
                pass
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)


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
    subprocess.run(
        ["python", "scripts/build/build_node_package.py"],
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
            f"curl/{CURL_VERSION}",
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
        "curlVersion": CURL_VERSION,
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
        "schemaVersion": "curl-parse-input/v2",
        "inputMode": "argv",
        "argv": argv[:200],
        "parseMode": rng.choice(["strict", "diagnostic"]),
        "runtimeProfile": generate_runtime_profile(rng, seed),
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
    wasm = NodeWasmParser()

    crash = 0
    timeout = 0
    mismatch = 0
    invalid_json = 0

    try:
        for _ in range(args.cases):
            case_input = generate_case(rng, seed, options)
            started = time.monotonic()

            try:
                with SuppressFd2():
                    native_output = native.parse(case_input)
                wasm_output = wasm.parse(case_input)
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
    finally:
        wasm.close()

    print(f"crash: {crash}")
    print(f"timeout: {timeout}")
    print(f"native-vs-wasm mismatch: {mismatch}")
    print(f"invalid-json-output: {invalid_json}")

    if crash or timeout or mismatch or invalid_json:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
