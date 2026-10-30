// Every compiled WASM variant must reproduce the native x86 reference
// (upstream's main platform, built from the same patched tree) for every
// algorithm on the shared fixture. Includes verthash with the real dataset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { Cmo } from '../src/wasm/api.ts';
import { builtVariants, loadModule, ROOT } from './helpers.ts';

interface GoldenEntry {
  algo: string;
  status: string;
  mode: 'scan' | 'direct';
  nonces: number;
  target7: number;
  nonce_index: number;
  solutions: { n: number; h: string }[];
}

// Each variant is compared with the native x86 build that runs the same code
// paths: sse41/sse42 with x86-64-v2, avx2 with x86-64-v3 (AVX2, no AES).
// (Paths can traverse the nonce space differently, so like must meet like.)
const GOLDEN = `${ROOT}test/golden/golden-x86.json`;
const GOLDEN_AVX2 = `${ROOT}test/golden/golden-x86-avx2.json`;
const VERTHASH = `${process.env.CMO_CACHE ?? '/cache'}/verthash.dat`;

/** "NAME|n=N|r=R|key=KEY" -> parts (key is last and may contain '|'-free text). */
export function parseCase(c: string): { name: string; paramN?: number; paramR?: number; key?: string } {
  const [name, ...rest] = c.split('|');
  const out: { name: string; paramN?: number; paramR?: number; key?: string } = { name };
  for (const p of rest) {
    if (p.startsWith('n=')) out.paramN = Number(p.slice(2));
    else if (p.startsWith('r=')) out.paramR = Number(p.slice(2));
    else if (p.startsWith('key=')) out.key = p.slice(4);
  }
  return out;
}

function loadVerthash(cmo: Cmo): void {
  const size = statSync(VERTHASH).size;
  const ptr = cmo.allocVerthash(size);
  const fd = openSync(VERTHASH, 'r');
  try {
    for (let off = 0; off < size; ) {
      const n = readSync(fd, cmo.bytes(ptr + off, Math.min(1 << 26, size - off)), 0, Math.min(1 << 26, size - off), off);
      if (n <= 0) throw new Error('short read of verthash.dat');
      off += n;
    }
  } finally {
    closeSync(fd);
  }
  cmo.setVerthash(ptr, size);
}

const load = (f: string): GoldenEntry[] => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : []);
const references: Record<string, GoldenEntry[]> = { x86: load(GOLDEN), 'x86-avx2': load(GOLDEN_AVX2) };

for (const [name, entries] of Object.entries(references)) {
  test(`golden reference ${name} exists`, () => {
    assert.ok(entries.length > 90, `run ./dev golden first (test/golden/golden-${name}.json)`);
    assert.ok(entries.every((e) => e.status !== 'ok' || (e.nonces && e.mode)), 'golden file is from the current harness');
    const empty = entries.filter((e) => e.status === 'ok' && !e.solutions.length).map((e) => e.algo);
    assert.deepEqual(empty, [], 'every reference case has solutions to compare');
  });
}

for (const v of builtVariants()) {
  const entries = references[v === 'avx2' ? 'x86-avx2' : 'x86'];
  for (const e of entries.filter((x) => x.status === 'ok')) {
    test(`[${v}] ${e.algo.split('|')[0]}${e.algo.includes('|') ? ' (params)' : ''}`, async () => {
      const c = parseCase(e.algo);
      const cmo = await Cmo.create(loadModule(v));
      const r = cmo.resolve(c.name);
      assert.ok(r, `resolve ${c.name}`);
      if (c.name === 'verthash') loadVerthash(cmo);
      const rc = cmo.init(r.id, { paramN: c.paramN ?? r.paramN, paramR: c.paramR, key: c.key, threadInit: true });
      assert.equal(rc, 0, `init: ${cmo.drainLog().join(' | ')}`);
      assert.equal(cmo.gateInfo().nonceIndex, e.nonce_index);

      const ours = new Map<number, string>();
      const hex = (h: Uint32Array) => Buffer.from(new Uint8Array(h.buffer, h.byteOffset, 32)).toString('hex');
      if (e.mode === 'direct') {
        // Scan pre-filter makes vectors impractical; compare direct hashes.
        const data = cmo.fixtureData();
        for (let n = 0; n < e.nonces; n++) {
          const h = cmo.directHash(data, n);
          assert.ok(h, 'direct hash entry point');
          ours.set(n, hex(h));
        }
        for (const s of e.solutions) assert.equal(ours.get(s.n), s.h, `nonce ${s.n}`);
        return;
      }
      const target = new Uint32Array(8).fill(0xffffffff);
      target[7] = e.target7;
      cmo.setScanWork(cmo.fixtureData(), target);
      cmo.scan(0, e.nonces);
      for (const s of cmo.solutions()) ours.set(s.data[e.nonce_index], hex(s.hash));
      // Lane counts differ between builds, so the last few nonces of the scan
      // may be covered by only one side; every common nonce must agree.
      const common = e.solutions.filter((s) => ours.has(s.n));
      for (const s of common) assert.equal(ours.get(s.n), s.h, `nonce ${s.n}`);
      if (e.solutions.length) {
        assert.ok(
          common.length >= Math.min(e.solutions.length, ours.size) * 0.75,
          `too few common solutions: golden ${e.solutions.length}, wasm ${ours.size}, common ${common.length}`,
        );
      }
    });
  }
}
