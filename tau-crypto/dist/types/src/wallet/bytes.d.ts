/** Decodes hex; throws unless it is hex (and exactly `bytes` long, if given). */
export declare function fromHex(text: string, bytes?: number): Uint8Array;
export declare const toHex: (bytes: Uint8Array) => string;
/** True for an even-length hex string (of exactly `bytes` bytes, if given). */
export declare const isHex: (s: unknown, bytes?: number) => s is string;
export declare const reversed: (bytes: Uint8Array) => Uint8Array;
export declare const sha256d: (bytes: Uint8Array) => Uint8Array;
export declare function concat(...parts: Uint8Array[]): Uint8Array;
/** Reverses the bytes of each 4-byte word (stratum's prevhash form <-> header bytes). */
export declare function swap32(bytes: Uint8Array): Uint8Array;
export declare function leBigInt(bytes: Uint8Array): bigint;
