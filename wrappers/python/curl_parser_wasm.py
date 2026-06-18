from __future__ import annotations

import json
import struct
from pathlib import Path
from typing import Any

from wasmtime import Engine, Linker, Module, Store, WasiConfig


class CurlParserWasm:
    def __init__(self, wasm_path: str | Path):
        self.engine = Engine()
        self.store = Store(self.engine)

        wasi_config = WasiConfig()
        self.store.set_wasi(wasi_config)

        self.linker = Linker(self.engine)
        self.linker.define_wasi()

        self.module = Module.from_file(self.engine, str(wasm_path))
        self.instance = self.linker.instantiate(self.store, self.module)

        exports = self.instance.exports(self.store)
        self.memory = exports["memory"]
        self._initialize = exports.get("_initialize")
        self.curlparse_alloc = exports["curlparse_alloc"]
        self.curlparse_free = exports["curlparse_free"]
        self.curlparse_parse = exports["curlparse_parse"]
        self._initialized = False

    def _ensure_initialized(self) -> None:
        if not self._initialized and self._initialize is not None:
            self._initialize(self.store)
            self._initialized = True

    def _read_u32(self, ptr: int) -> int:
        data = bytes(self.memory.read(self.store, ptr, ptr + 4))
        return struct.unpack("<I", data)[0]

    def parse(self, input_obj: dict[str, Any]) -> dict[str, Any]:
        self._ensure_initialized()

        input_bytes = json.dumps(
            input_obj,
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode("utf-8")
        input_data = input_bytes + b"\0"

        input_ptr = self.curlparse_alloc(self.store, len(input_data))
        if not input_ptr:
            raise RuntimeError("curlparse_alloc failed for input buffer")

        self.memory.write(self.store, input_data, input_ptr)

        pair_ptr = self.curlparse_alloc(self.store, 8)
        if not pair_ptr:
            self.curlparse_free(self.store, input_ptr, len(input_data))
            raise RuntimeError("curlparse_alloc failed for output pair")

        rc = self.curlparse_parse(
            self.store,
            input_ptr,
            len(input_bytes),
            pair_ptr,
        )

        self.curlparse_free(self.store, input_ptr, len(input_data))

        if rc != 0:
            self.curlparse_free(self.store, pair_ptr, 8)
            raise RuntimeError(f"curlparse_parse ABI error: {rc}")

        out_ptr = self._read_u32(pair_ptr)
        out_len = self._read_u32(pair_ptr + 4)

        output_bytes = bytes(
            self.memory.read(self.store, out_ptr, out_ptr + out_len)
        )

        self.curlparse_free(self.store, out_ptr, out_len)
        self.curlparse_free(self.store, pair_ptr, 8)

        return json.loads(output_bytes.decode("utf-8"))

