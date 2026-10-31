// Instantiates a standalone cmo-*.wasm module. The modules import only a
// handful of WASI calls (printf output from a few algos) plus Emscripten's
// memory-growth notice, so the same loader works in Node, browsers and workers.

export class CmoExit extends Error {
  readonly code: number;
  constructor(code: number) {
    super(`cpuminer-opt called exit(${code})`);
    this.code = code;
  }
}

export interface RawExports {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  [name: string]: unknown;
}

const ESPIPE = 70;
const decoder = new TextDecoder();

export async function instantiate(
  module: WebAssembly.Module,
  onOutput: (line: string) => void = () => {},
): Promise<RawExports> {
  let memory: WebAssembly.Memory | undefined;
  const pending = new Map<number, string>();

  const imports = {
    env: {
      emscripten_notify_memory_growth: () => {},
    },
    wasi_snapshot_preview1: {
      fd_write(fd: number, iovs: number, iovsLen: number, nwritten: number): number {
        const view = new DataView(memory!.buffer);
        const bytes = new Uint8Array(memory!.buffer);
        let total = 0;
        let text = pending.get(fd) ?? '';
        for (let i = 0; i < iovsLen; i++) {
          const ptr = view.getUint32(iovs + i * 8, true);
          const len = view.getUint32(iovs + i * 8 + 4, true);
          text += decoder.decode(bytes.subarray(ptr, ptr + len));
          total += len;
        }
        const lines = text.split('\n');
        pending.set(fd, lines.pop() ?? '');
        for (const line of lines) if (line.trim()) onOutput(line);
        view.setUint32(nwritten, total, true);
        return 0;
      },
      fd_close: () => 0,
      fd_seek: () => ESPIPE,
      proc_exit(code: number): never {
        throw new CmoExit(code);
      },
    },
  };

  const instance = await WebAssembly.instantiate(module, imports);
  const exports = instance.exports as unknown as RawExports;
  memory = exports.memory;
  exports._initialize?.();
  return exports;
}
