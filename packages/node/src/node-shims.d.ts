declare module "node:fs/promises" {
  export function readFile(path: string | URL): Promise<Uint8Array>;
}

declare module "node:wasi" {
  export class WASI {
    constructor(options: {
      version: "preview1";
      args?: string[];
      env?: Record<string, string>;
      preopens?: Record<string, string>;
    });
    getImportObject(): WebAssembly.Imports;
    initialize(instance: WebAssembly.Instance): void;
  }
}

declare const process: {
  argv: string[];
  exitCode?: number;
  stdin: {
    setEncoding(encoding: string): void;
    on(event: "data", listener: (chunk: string) => void): void;
    on(event: "end", listener: () => void): void;
  };
  stdout: {
    write(chunk: string): void;
  };
  stderr: {
    write(chunk: string): void;
  };
};
