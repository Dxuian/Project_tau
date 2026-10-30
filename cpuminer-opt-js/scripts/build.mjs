// Builds dist/: the library (ESM, one lazy chunk per WASM variant), the CLI,
// the bridge and type declarations. The worker is bundled first and inlined
// as a string, so dist/ needs no separate worker or .wasm files.
// Runs inside the dev container: ./dev build
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as esbuild from 'esbuild';
import { embedVariants, generateAlgoTables } from './embed-wasm.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');

if (!existsSync(join(ROOT, 'native/out/cmo-sse41.wasm'))) {
  console.error('native/out/cmo-sse41.wasm is missing: run ./dev wasm first');
  process.exit(1);
}
console.log('embedded:', embedVariants().join(', '));
generateAlgoTables();

rmSync(DIST, { recursive: true, force: true });

const common = {
  bundle: true,
  target: 'es2022',
  platform: 'neutral',
  logLevel: 'warning',
  legalComments: 'none',
  absWorkingDir: ROOT,
};

// 1. Worker: one self-contained classic script (works as a Node eval worker and a Blob Web Worker).
const worker = await esbuild.build({
  ...common,
  entryPoints: ['src/pool/worker-entry.ts'],
  format: 'iife',
  write: false,
});
const workerCode = worker.outputFiles[0].text;
if (/gzipBase64/.test(workerCode)) throw new Error('worker bundle must not include the embedded WASM');

const inlineWorker = {
  name: 'inline-worker',
  setup(build) {
    build.onLoad({ filter: /src[\\/]pool[\\/]worker-source\.ts$/ }, () => ({
      contents: `export const WORKER_SOURCE = ${JSON.stringify(workerCode)};`,
      loader: 'ts',
    }));
  },
};

// 2. Library, CLI and bridge, sharing chunks.
await esbuild.build({
  ...common,
  entryPoints: { index: 'src/index.ts', cli: 'bin/cli.ts', bridge: 'bridge/server.ts' },
  format: 'esm',
  splitting: true,
  outdir: DIST,
  chunkNames: 'chunks/[name]-[hash]',
  plugins: [inlineWorker],
});

const cli = join(DIST, 'cli.js');
writeFileSync(cli, `#!/usr/bin/env node\n${readFileSync(cli, 'utf8')}`);
chmodSync(cli, 0o755);

// 3. Type declarations.
const tsc = spawnSync('npx', ['tsc', '-p', 'tsconfig.build.json'], { cwd: ROOT, stdio: 'inherit' });
if (tsc.status !== 0) console.warn('warning: declaration emit failed (dist/ JavaScript is complete)');

let total = 0;
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else total += statSync(p).size;
  }
};
walk(DIST);
console.log(`dist/ built: worker ${(workerCode.length / 1024).toFixed(0)} KiB inline, total ${(total / 1048576).toFixed(1)} MiB`);
