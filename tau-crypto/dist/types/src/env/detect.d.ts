import type { Capabilities, RuntimeName } from '../types.ts';
export declare function detectRuntime(): RuntimeName;
/** Imports a Node built-in without letting browser bundlers see it. */
export declare function nodeBuiltin<T = any>(name: string): Promise<T>;
export interface DetectOptions {
    /** Probe WebGPU (requests an adapter). Default true. */
    gpu?: boolean;
}
export declare function detect(options?: DetectOptions): Promise<Capabilities>;
