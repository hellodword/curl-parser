const ERRNO_SUCCESS = 0;
const ERRNO_BADF = 8;
const ERRNO_FAULT = 21;
const ERRNO_NOENT = 44;
const RANDOM_GET_CHUNK_SIZE = 65536;

type WasiFunction = (...args: number[]) => number | void;
type WasiModule = Record<string, WasiFunction>;
type InstanceSetter = (instance: WebAssembly.Instance) => void;

interface BrowserWasiHost {
  imports: WebAssembly.Imports;
  setInstance: InstanceSetter;
}

const decoder = new TextDecoder();

function memoryFor(instance: WebAssembly.Instance | null): WebAssembly.Memory | null {
  const memory = instance?.exports.memory;
  return memory instanceof WebAssembly.Memory ? memory : null;
}

function writeU32(memory: WebAssembly.Memory, ptr: number, value: number): void {
  new DataView(memory.buffer).setUint32(ptr, value, true);
}

function randomGet(
  getInstance: () => WebAssembly.Instance | null,
  ptr: number,
  len: number,
): number {
  const memory = memoryFor(getInstance());
  if (!memory || ptr < 0 || len < 0 || ptr + len > memory.buffer.byteLength) {
    return ERRNO_FAULT;
  }

  const bytes = new Uint8Array(memory.buffer, ptr, len);
  const crypto = globalThis.crypto;
  if (crypto?.getRandomValues) {
    for (let offset = 0; offset < bytes.length; offset += RANDOM_GET_CHUNK_SIZE) {
      crypto.getRandomValues(bytes.subarray(offset, offset + RANDOM_GET_CHUNK_SIZE));
    }
  } else {
    for (let offset = 0; offset < bytes.length; offset += 1) {
      bytes[offset] = Math.floor(Math.random() * 256);
    }
  }

  return ERRNO_SUCCESS;
}

function fdWrite(
  getInstance: () => WebAssembly.Instance | null,
  fd: number,
  iovsPtr: number,
  iovsLen: number,
  writtenPtr: number,
): number {
  if (fd !== 1 && fd !== 2) {
    return ERRNO_BADF;
  }

  const memory = memoryFor(getInstance());
  if (!memory) {
    return ERRNO_BADF;
  }

  const view = new DataView(memory.buffer);
  const bytes = new Uint8Array(memory.buffer);
  let written = 0;
  let text = "";

  for (let i = 0; i < iovsLen; i += 1) {
    const offset = iovsPtr + i * 8;
    const ptr = view.getUint32(offset, true);
    const len = view.getUint32(offset + 4, true);
    text += decoder.decode(bytes.subarray(ptr, ptr + len));
    written += len;
  }

  writeU32(memory, writtenPtr, written);
  if (text) {
    (fd === 2 ? console.warn : console.log)(text);
  }
  return ERRNO_SUCCESS;
}

export function createBrowserWasiImports(): BrowserWasiHost {
  let instance: WebAssembly.Instance | null = null;
  const wasi: WasiModule = {
    fd_close: () => ERRNO_SUCCESS,
    environ_get: () => ERRNO_SUCCESS,
    environ_sizes_get: () => ERRNO_SUCCESS,
    fd_fdstat_get: () => ERRNO_SUCCESS,
    fd_fdstat_set_flags: () => ERRNO_SUCCESS,
    fd_filestat_get: () => ERRNO_BADF,
    fd_prestat_get: () => ERRNO_BADF,
    fd_prestat_dir_name: () => ERRNO_BADF,
    fd_read: () => ERRNO_BADF,
    fd_seek: () => ERRNO_BADF,
    fd_write: (fd, iovsPtr, iovsLen, writtenPtr) =>
      fdWrite(() => instance, fd, iovsPtr, iovsLen, writtenPtr),
    path_filestat_get: () => ERRNO_NOENT,
    path_open: () => ERRNO_NOENT,
    proc_exit: (code: number) => {
      throw new Error(`wasm exited with status ${code}`);
    },
    random_get: (ptr, len) => randomGet(() => instance, ptr, len),
  };

  return {
    imports: {
      wasi_snapshot_preview1: wasi,
    },
    setInstance: (value) => {
      instance = value;
    },
  };
}
