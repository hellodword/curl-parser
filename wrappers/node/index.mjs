import { readFile } from "node:fs/promises";
import { WASI } from "node:wasi";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function memoryBytes(instance) {
  return new Uint8Array(instance.exports.memory.buffer);
}

function readU32(instance, ptr) {
  return new DataView(instance.exports.memory.buffer).getUint32(ptr, true);
}

function writeJson(instance, value) {
  const bytes = encoder.encode(JSON.stringify(value));
  const ptr = instance.exports.curlparse_alloc(bytes.length + 1);

  if (!ptr) {
    throw new Error("curlparse_alloc failed for input buffer");
  }

  memoryBytes(instance).set(bytes, ptr);
  memoryBytes(instance)[ptr + bytes.length] = 0;
  return [ptr, bytes.length];
}

export async function createCurlParserWasm(options = {}) {
  const wasmPath =
    options.wasmPath ?? new URL("../../dist/curl_parser.wasm", import.meta.url);
  const wasmBytes = await readFile(wasmPath);
  const wasi = new WASI({
    version: "preview1",
    args: [],
    env: {},
    preopens: {},
  });
  const { instance } = await WebAssembly.instantiate(
    wasmBytes,
    wasi.getImportObject(),
  );

  wasi.initialize(instance);

  return {
    parse(input) {
      const [inputPtr, inputLen] = writeJson(instance, input);
      const pairPtr = instance.exports.curlparse_alloc(8);

      if (!pairPtr) {
        instance.exports.curlparse_free(inputPtr, inputLen);
        throw new Error("curlparse_alloc failed for output pair");
      }

      const rc = instance.exports.curlparse_parse(inputPtr, inputLen, pairPtr);

      instance.exports.curlparse_free(inputPtr, inputLen);

      if (rc !== 0) {
        instance.exports.curlparse_free(pairPtr, 8);
        throw new Error(`curlparse_parse ABI error: ${rc}`);
      }

      const outPtr = readU32(instance, pairPtr);
      const outLen = readU32(instance, pairPtr + 4);
      const outBytes = new Uint8Array(
        instance.exports.memory.buffer,
        outPtr,
        outLen,
      );
      const outText = decoder.decode(outBytes);

      instance.exports.curlparse_free(outPtr, outLen);
      instance.exports.curlparse_free(pairPtr, 8);

      return JSON.parse(outText);
    },
  };
}
