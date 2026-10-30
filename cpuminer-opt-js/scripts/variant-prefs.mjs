// Measures every algorithm in every compiled WASM variant (single thread, V8)
// and writes src/tune/variant-prefs.ts with the fastest variant per algorithm.
// Browser quick-mode autotune uses it to load just one variant.
// Runs inside the dev container: node scripts/variant-prefs.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Cmo } from '../src/wasm/api.ts';
import { listAlgorithms } from '../src/algos.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const VARIANTS = ['sse41', 'sse42', 'avx2'];
const modules = Object.fromEntries(
  VARIANTS.map((v) => [v, new WebAssembly.Module(readFileSync(join(ROOT, `native/out/cmo-${v}.wasm`)))]),
);

function benchData() {
  const data = new Uint32Array(48);
  data[20] = 0x80000000;
  data[31] = 0x280;
  return data;
}

async function rate(variant, algo, ms) {
  const cmo = await Cmo.create(modules[variant]);
  if (cmo.init(algo.id, { threadInit: true }) !== 0) return 0;
  const target = new Uint32Array(8); // nothing passes: measures the plain hashing path
  cmo.setScanWork(benchData(), target);
  let chunk = 16;
  let n = 0;
  for (const end = performance.now() + ms / 3; performance.now() < end; ) {
    const t0 = performance.now();
    cmo.scan(n, n + chunk);
    n += chunk;
    if (performance.now() - t0 < 10) chunk *= 2;
  }
  let hashes = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    hashes += cmo.scan(n, n + chunk);
    n += chunk;
  }
  return (hashes / (performance.now() - t0)) * 1000;
}

const prefs = {};
const rows = [];
for (const a of listAlgorithms()) {
  if (a.status !== 'ok') continue;
  const r = {};
  for (const v of VARIANTS) r[v] = await rate(v, a, 250);
  const best = VARIANTS.reduce((x, y) => (r[y] > r[x] * 1.03 ? y : x), 'sse41'); // need a clear win over sse41
  if (best !== 'sse41') prefs[a.name] = best;
  rows.push(`${a.name.padEnd(14)} ${VARIANTS.map((v) => r[v].toFixed(0).padStart(11)).join('')}  -> ${best}`);
  console.log(rows[rows.length - 1]);
}

writeFileSync(
  join(ROOT, 'src/tune/variant-prefs.ts'),
  `// Fastest compiled variant per algorithm, measured with scripts/variant-prefs.mjs\n` +
    `// (V8, dev container, single thread). Lets quick-mode autotune load just one\n` +
    `// variant in browsers. Algorithms not listed default to sse41.\n` +
    `import type { WasmVariant } from '../types.ts';\n\n` +
    `export const VARIANT_PREFS: Record<string, WasmVariant> = ${JSON.stringify(prefs, null, 2)};\n`,
);
console.log(`wrote src/tune/variant-prefs.ts (${Object.keys(prefs).length} algorithms prefer a non-sse41 variant)`);
