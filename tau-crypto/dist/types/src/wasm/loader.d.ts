export declare class CmoExit extends Error {
    readonly code: number;
    constructor(code: number);
}
export interface RawExports {
    memory: WebAssembly.Memory;
    _initialize?: () => void;
    [name: string]: unknown;
}
export declare function instantiate(module: WebAssembly.Module, onOutput?: (line: string) => void): Promise<RawExports>;
