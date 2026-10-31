// Byte and hex helpers shared by the wallet and payout code.
import { sha256 } from '@noble/hashes/sha2.js';

/** Decodes hex; throws unless it is hex (and exactly `bytes` long, if given). */
export function fromHex(text: string, bytes?: number): Uint8Array {
  if (typeof text !== 'string' || text.length % 2 || !/^[0-9a-f]*$/i.test(text)) throw new Error('invalid hex');
  if (bytes !== undefined && text.length !== bytes * 2) throw new Error(`expected ${bytes} bytes of hex`);
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(text.substr(i * 2, 2), 16);
  return out;
}

export const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** True for an even-length hex string (of exactly `bytes` bytes, if given). */
export const isHex = (s: unknown, bytes?: number): s is string =>
  typeof s === 'string' && s.length % 2 === 0 && /^[0-9a-f]*$/i.test(s) && (bytes === undefined || s.length === bytes * 2);

export const reversed = (bytes: Uint8Array): Uint8Array => Uint8Array.from(bytes).reverse();

export const sha256d = (bytes: Uint8Array): Uint8Array => sha256(sha256(bytes));

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Reverses the bytes of each 4-byte word (stratum's prevhash form <-> header bytes). */
export function swap32(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 4) {
    out[i] = bytes[i + 3];
    out[i + 1] = bytes[i + 2];
    out[i + 2] = bytes[i + 1];
    out[i + 3] = bytes[i];
  }
  return out;
}

export function leBigInt(bytes: Uint8Array): bigint {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]);
  return n;
}
