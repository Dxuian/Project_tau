// Compiles the patched cpuminer-opt tree + shim into one standalone .wasm per
// SIMD variant (native/out/cmo-<variant>.wasm). Runs inside the dev container:
//   ./dev wasm [--variant sse41,...] [--keep-going]
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { COMMON_DEFINES, prepareSource, SRC, upstreamSources } from './prepare-src.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const CACHE = process.env.CMO_CACHE ?? '/cache';
const OUT = join(ROOT, 'native/out');
const SHIM = join(ROOT, 'native/shim');

export const VARIANTS = {
  sse41: ['-msimd128', '-msse4.1'],
  sse42: ['-msimd128', '-msse4.2'],
  avx2: ['-msimd128', '-mavx2'],
};

export const WARNINGS = [
  '-Wno-pointer-sign',
  '-Wno-pointer-to-int-cast',
  '-Wno-deprecated-non-prototype',
  '-Werror=constant-conversion',
];

export const SHIM_SOURCES = [
  ...['globals.c', 'ported.c', 'cmo.c', 'direct.c', 'malloc-huge.c'].map((f) => join(SHIM, f)),
  join(ROOT, 'native/kernels/sha256_fast.c'),
];

export function includeFlags(src = SRC) {
  return [
    `-I${join(SHIM, 'include')}`,
    `-I${SHIM}`,
    `-I${src}`,
    `-I${join(src, 'compat/jansson')}`,
    '-include',
    join(SHIM, 'include/cmo-prelude.h'),
  ];
}

function exportedFunctions() {
  const text = ['cmo.c', 'direct.c'].map((f) => readFileSync(join(SHIM, f), 'utf8')).join('\n');
  const names = [...text.matchAll(/CMO_EXPORT\s+[\w\s*]+?\b(cmo_\w+)\s*\(/g)].map((m) => `_${m[1]}`);
  return [...new Set(names)];
}

function run(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });
}

async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    }),
  );
  return results;
}

async function buildVariant(name, { keepGoing }) {
  const flags = ['-std=gnu17', '-O3', ...VARIANTS[name], '-fno-strict-aliasing', ...COMMON_DEFINES, ...WARNINGS];
  const objDir = join(CACHE, 'obj', name);
  rmSync(objDir, { recursive: true, force: true });
  const sources = [...upstreamSources().map((f) => join(SRC, f)), ...SHIM_SOURCES];
  const started = Date.now();

  const results = await pool(sources, availableParallelism(), async (file) => {
    const rel = file.startsWith(SRC) ? relative(SRC, file) : `shim/${relative(SHIM, file)}`;
    const obj = join(objDir, rel.replace(/\.c$/, '.o'));
    mkdirSync(dirname(obj), { recursive: true });
    const { code, out } = await run('emcc', [...flags, ...includeFlags(), '-I/opt/gmp-wasm/include', '-c', file, '-o', obj]);
    return { rel, obj, ok: code === 0, out };
  });

  const failed = results.filter((r) => !r.ok);
  const log = results
    .filter((r) => r.out.trim())
    .map((r) => `==== ${r.rel} ${r.ok ? '(warnings)' : '(FAILED)'}\n${r.out}`)
    .join('\n');
  const logFile = join(CACHE, 'logs', `wasm-${name}.log`);
  mkdirSync(dirname(logFile), { recursive: true });
  writeFileSync(logFile, log);

  if (failed.length) {
    console.error(`[${name}] ${failed.length}/${results.length} sources failed (full log: ${logFile})`);
    for (const f of failed.slice(0, keepGoing ? failed.length : 15)) {
      const first = f.out.split('\n').find((l) => /error:/.test(l)) ?? f.out.split('\n')[0];
      console.error(`  ${f.rel}: ${first.replace(/^.*?error:\s*/, '')}`);
    }
    return false;
  }

  const exports = exportedFunctions();
  const wasm = join(OUT, `cmo-${name}.wasm`);
  mkdirSync(OUT, { recursive: true });
  const link = await run('emcc', [
    '-O3',
    ...VARIANTS[name],
    ...results.map((r) => r.obj),
    '/opt/gmp-wasm/lib/libgmp.a',
    '-o',
    wasm,
    '-sSTANDALONE_WASM',
    '--no-entry',
    '-sALLOW_MEMORY_GROWTH=1',
    '-sMAXIMUM_MEMORY=4GB',
    '-sSTACK_SIZE=1MB',
    '-sINITIAL_MEMORY=32MB',
    `-sEXPORTED_FUNCTIONS=${exports.join(',')}`,
  ]);
  if (link.code !== 0) {
    console.error(`[${name}] link failed:\n${link.out}`);
    return false;
  }
  // wasm-ld turns calls with mismatched signatures into traps and only warns.
  if (/signature mismatch|warning/i.test(link.out)) {
    console.error(`[${name}] link warnings:\n${link.out}`);
    if (/signature mismatch/i.test(link.out)) return false;
  }
  const size = (readFileSync(wasm).length / 1048576).toFixed(1);
  console.log(`[${name}] ok: ${relative(ROOT, wasm)} (${size} MiB, ${results.length} objects, ${((Date.now() - started) / 1000).toFixed(0)} s)`);
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const keepGoing = args.includes('--keep-going');
  const vi = args.indexOf('--variant');
  const names = vi >= 0 ? args[vi + 1].split(',') : Object.keys(VARIANTS);
  for (const n of names) if (!VARIANTS[n]) throw new Error(`unknown variant ${n}`);

  prepareSource();

  let ok = true;
  for (const n of names) ok = (await buildVariant(n, { keepGoing })) && ok;
  if (!ok) process.exit(1);

  const { embedVariants, generateAlgoTables } = await import('./embed-wasm.mjs');
  console.log('embedded:', embedVariants().join(', '));
  const t = generateAlgoTables();
  console.log(`algo tables: ${t.algos} algorithms, ${t.aliases} aliases`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
