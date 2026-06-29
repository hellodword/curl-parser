import type { GenerateInput, GenerateOutput, ParseInput, ParseOutput } from "./types.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class CurlParserError extends Error {
  readonly code: string;
  readonly abiCode?: number;

  constructor(message: string, options: { code: string; abiCode?: number }) {
    super(message);
    this.name = "CurlParserError";
    this.code = options.code;
    this.abiCode = options.abiCode;
  }
}

type WasmExports = WebAssembly.Exports & {
  memory: WebAssembly.Memory;
  curlparse_alloc(size: number): number;
  curlparse_free(ptr: number, len: number): void;
  curlparse_buf_free?(ptr: number, len: number): void;
  curlparse_engine_new(): number;
  curlparse_engine_free(engine: number): void;
  curlparse_parse_json(engine: number, inputPtr: number, inputLen: number, outPairPtr: number): number;
  curlparse_generate_json(
    engine: number,
    inputPtr: number,
    inputLen: number,
    outPairPtr: number,
  ): number;
};

function isInstantiatedSource(
  value: WebAssembly.Instance | WebAssembly.WebAssemblyInstantiatedSource,
): value is WebAssembly.WebAssemblyInstantiatedSource {
  return "instance" in value;
}

function exportsOf(instance: WebAssembly.Instance): WasmExports {
  return instance.exports as WasmExports;
}

function memoryBytes(exports: WasmExports): Uint8Array {
  return new Uint8Array(exports.memory.buffer);
}

function readU32(exports: WasmExports, ptr: number): number {
  return new DataView(exports.memory.buffer).getUint32(ptr, true);
}

function abiError(functionName: string, rc: number): CurlParserError {
  const code = rc === -7 ? "E_ABI_UNIMPLEMENTED" : "E_ABI_ERROR";
  return new CurlParserError(`${functionName} ABI error: ${rc}`, {
    code,
    abiCode: rc,
  });
}

function writeJson(exports: WasmExports, value: unknown): [number, number] {
  const bytes = encoder.encode(JSON.stringify(value));
  const ptr = exports.curlparse_alloc(bytes.length + 1);

  if (!ptr) {
    throw new CurlParserError("curlparse_alloc failed for input buffer", {
      code: "E_WASM_ALLOC",
    });
  }

  memoryBytes(exports).set(bytes, ptr);
  memoryBytes(exports)[ptr + bytes.length] = 0;
  return [ptr, bytes.length];
}

export class CurlParserWasm {
  readonly instance: WebAssembly.Instance;
  private readonly exports: WasmExports;
  private readonly engineHandle: number;
  private disposed = false;

  constructor(instance: WebAssembly.Instance) {
    this.instance = instance;
    this.exports = exportsOf(instance);
    this.engineHandle = this.exports.curlparse_engine_new();

    if (!this.engineHandle) {
      throw new CurlParserError("curlparse_engine_new failed", {
        code: "E_WASM_ENGINE",
      });
    }
  }

  static async instantiate(
    source: BufferSource | WebAssembly.Module,
    imports: WebAssembly.Imports = {},
    onInstantiate?: (instance: WebAssembly.Instance) => void,
  ): Promise<CurlParserWasm> {
    const instantiated =
      source instanceof WebAssembly.Module
        ? await WebAssembly.instantiate(source, imports)
        : await WebAssembly.instantiate(source, imports);
    const instance = isInstantiatedSource(instantiated)
      ? instantiated.instance
      : instantiated;
    onInstantiate?.(instance);
    return new CurlParserWasm(instance);
  }

  private ensureOpen(): void {
    if (this.disposed) {
      throw new CurlParserError("CurlParserWasm is disposed", {
        code: "E_DISPOSED",
      });
    }
  }

  private callJson<T>(functionName: "curlparse_parse_json" | "curlparse_generate_json", input: unknown): T {
    this.ensureOpen();

    const parseFn = this.exports[functionName];
    if (typeof parseFn !== "function") {
      throw new CurlParserError(`${functionName} export is missing`, {
        code: "E_WASM_EXPORT",
      });
    }

    const [inputPtr, inputLen] = writeJson(this.exports, input);
    const pairPtr = this.exports.curlparse_alloc(8);

    if (!pairPtr) {
      this.exports.curlparse_free(inputPtr, inputLen);
      throw new CurlParserError("curlparse_alloc failed for output pair", {
        code: "E_WASM_ALLOC",
      });
    }

    const rc = parseFn(this.engineHandle, inputPtr, inputLen, pairPtr);
    this.exports.curlparse_free(inputPtr, inputLen);

    if (rc !== 0) {
      this.exports.curlparse_free(pairPtr, 8);
      throw abiError(functionName, rc);
    }

    const outPtr = readU32(this.exports, pairPtr);
    const outLen = readU32(this.exports, pairPtr + 4);
    const outBytes = new Uint8Array(this.exports.memory.buffer, outPtr, outLen);
    const outText = decoder.decode(outBytes);
    const freeOutput = this.exports.curlparse_buf_free ?? this.exports.curlparse_free;

    freeOutput(outPtr, outLen);
    this.exports.curlparse_free(pairPtr, 8);

    return JSON.parse(outText) as T;
  }

  parse(input: ParseInput): ParseOutput {
    return this.callJson<ParseOutput>("curlparse_parse_json", input);
  }

  generate(input: GenerateInput): GenerateOutput {
    return this.callJson<GenerateOutput>("curlparse_generate_json", input);
  }

  dispose(): void {
    if (!this.disposed) {
      this.exports.curlparse_engine_free(this.engineHandle);
      this.disposed = true;
    }
  }
}
