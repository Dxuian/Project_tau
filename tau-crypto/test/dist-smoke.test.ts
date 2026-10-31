// dist/ must be self-contained: copied into an empty folder with no
// node_modules, plain Node can import it, hash, detect and benchmark (which
// spawns the embedded worker bundle).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GENESIS_HASH, GENESIS_WORDS, headerBytes, ROOT } from './helpers.ts';

const DIST = join(ROOT, 'dist');

test('dist/ works from an empty folder (no node_modules)', { skip: !existsSync(join(DIST, 'index.js')) && 'run ./dev build first' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'cmo-smoke-'));
  try {
    cpSync(DIST, join(dir, 'tau-crypto'), { recursive: true });
    const header = headerBytes(GENESIS_WORDS).toString('hex');
    writeFileSync(
      join(dir, 'smoke.mjs'),
      `import { detect, listAlgorithms, hash, benchmark } from './tau-crypto/index.js';
const caps = await detect({ gpu: false });
const h = Buffer.from(await hash('sha256d', Buffer.from('${header}', 'hex'))).reverse().toString('hex');
const r = await benchmark({ algo: 'sha256d', backend: 'wasm-sha256-x8', threads: 2, seconds: 1, warmupMs: 50, measureMs: 200 });
console.log(JSON.stringify({ runtime: caps.runtime, simd: caps.wasm.simd128, algos: listAlgorithms().length, h, total: r.totalHps, threads: r.plan.cpu.threads }));
`,
    );
    const out = JSON.parse(execFileSync(process.execPath, ['smoke.mjs'], { cwd: dir, encoding: 'utf8' }).trim().split('\n').pop()!);
    assert.equal(out.runtime, 'node');
    assert.equal(out.simd, true);
    assert.equal(out.algos, 91);
    assert.equal(out.h, GENESIS_HASH);
    assert.equal(out.threads, 2);
    assert.ok(out.total > 1e5, `benchmark rate ${out.total}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
