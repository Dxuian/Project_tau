// Copies native/vendor/cpuminer-opt into $CMO_CACHE/src and applies the patch
// set in native/patches/patches.mjs. Each edit must match exactly as often as
// declared, so an upstream change can't silently skip a patch.
// Runs inside the dev container (used by build-wasm.mjs and ./dev golden).
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { patches } from '../native/patches/patches.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const VENDOR = join(ROOT, 'native/vendor/cpuminer-opt');
export const SRC = join(process.env.CMO_CACHE ?? '/cache', 'src');

// Same defines for every build of the tree (WASM variants and golden harness).
export const COMMON_DEFINES = [
  '-DNOASM',
  '-DARGON2_NO_THREADS',
  '-DSPH_JH_64=1',
  '-DSPH_ECHO_64=1',
  '-DSPH_LUFFA_PARALLEL=1',
  '-DSPH_LITTLE_ENDIAN=1',
];

const SKIP_SOURCES = new Set(['dummy.cpp', 'cpu-miner.c', 'util.c', 'api.c', 'sysinfos.c', 'malloc-huge.c']);

// Sources from Makefile.am's cpuminer_SOURCES, minus the files the shim replaces,
// plus the bundled jansson. Paths are relative to the patched tree.
export function upstreamSources(src = SRC) {
  const am = readFileSync(join(src, 'Makefile.am'), 'utf8');
  const block = am.match(/^cpuminer_SOURCES\s*=([\s\S]*?)\n\s*\n/m);
  if (!block) throw new Error('cpuminer_SOURCES not found in Makefile.am');
  const files = block[1]
    .split(/\\?\s+/)
    .map((s) => s.trim())
    .filter((s) => s && !SKIP_SOURCES.has(s));
  const jansson = readdirSync(join(src, 'compat/jansson'))
    .filter((f) => f.endsWith('.c'))
    .map((f) => `compat/jansson/${f}`);
  return [...files, ...jansson];
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(c|h)$/.test(name)) out.push(p);
  }
  return out;
}

function countLiteral(text, find) {
  let n = 0;
  for (let i = text.indexOf(find); i !== -1; i = text.indexOf(find, i + find.length)) n++;
  return n;
}

export function prepareSource({ quiet = false } = {}) {
  if (!existsSync(join(VENDOR, 'cpu-miner.c'))) {
    throw new Error('native/vendor/cpuminer-opt is missing; run ./dev vendor first');
  }
  rmSync(SRC, { recursive: true, force: true });
  cpSync(VENDOR, SRC, { recursive: true });

  const ctx = {
    allSources: () => walk(join(SRC, 'algo')).map((p) => readFileSync(p, 'utf8')),
  };
  const report = [];

  for (const p of patches) {
    if (p.transform) {
      const targets = p.files.flatMap((f) => {
        const abs = join(SRC, f);
        return statSync(abs).isDirectory() ? walk(abs) : [abs];
      });
      let total = 0;
      const touched = [];
      for (const file of targets) {
        const before = readFileSync(file, 'utf8');
        const { src, count } = p.transform(before, ctx);
        if (count > 0) {
          writeFileSync(file, src);
          total += count;
          touched.push(`${relative(SRC, file)} (${count})`);
        }
      }
      if (total === 0) throw new Error(`patch "${p.id}" changed nothing`);
      report.push(`${p.id}: ${total} edits\n    ${touched.join('\n    ')}\n    why: ${p.why}`);
      continue;
    }

    const file = join(SRC, p.file);
    const text = readFileSync(file, 'utf8');
    const want = p.count ?? 1;
    let next;
    let got;
    if (p.regex) {
      got = [...text.matchAll(p.regex)].length;
      next = text.replace(p.regex, p.replace);
    } else {
      got = countLiteral(text, p.find);
      next = text.split(p.find).join(p.replace);
    }
    if (got !== want) {
      throw new Error(`patch "${p.id}" matched ${got} times in ${p.file}, expected ${want}`);
    }
    writeFileSync(file, next);
    report.push(`${p.id}: ${p.file} (${got})\n    why: ${p.why}`);
  }

  writeFileSync(join(SRC, 'CMO_PATCHES.txt'), report.join('\n') + '\n');
  // For scripts/golden.sh, which also runs in the ref-amd64 image (no Node).
  writeFileSync(join(SRC, 'CMO_SOURCES.txt'), upstreamSources().join('\n') + '\n');
  writeFileSync(join(SRC, 'CMO_DEFINES.txt'), COMMON_DEFINES.join(' ') + '\n');
  if (!quiet) console.log(`prepared ${SRC}: ${patches.length} patches applied`);
  return SRC;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    prepareSource();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
