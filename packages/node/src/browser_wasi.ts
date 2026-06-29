const ERRNO_SUCCESS = 0;
const ERRNO_BADF = 8;
const ERRNO_NOENT = 44;

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
