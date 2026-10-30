// Copies the pinned cpuminer-opt sources from /upstream (the read-only mount of
// ../cpuminer-opt) into native/vendor/cpuminer-opt and records the commit.
// Runs inside the dev container: ./dev vendor
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';

const UPSTREAM = '/upstream';
const DEST = new URL('../native/vendor/cpuminer-opt', import.meta.url).pathname;
const PINNED_COMMIT = 'b34565b';

// Not needed for the WASM build or the reference harness.
const SKIP = new Set(['.git', 'junk', 'res', 'api', 'CLAUDE.md', 'configure~', 'Dockerfile']);

if (!existsSync(join(UPSTREAM, 'cpu-miner.c'))) {
  console.error(`No cpuminer-opt checkout at ${UPSTREAM} (expected ../cpuminer-opt on the host).`);
  process.exit(1);
}

const commit = execFileSync('git', ['-c', 'safe.directory=*', '-C', UPSTREAM, 'rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
if (!commit.startsWith(PINNED_COMMIT)) {
  console.error(`Upstream is at ${commit}, expected ${PINNED_COMMIT} (v26.1).`);
  process.exit(1);
}

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
cpSync(UPSTREAM, DEST, {
  recursive: true,
  filter: (src) => {
    const rel = relative(UPSTREAM, src);
    return rel === '' || !SKIP.has(rel.split('/')[0]);
  },
});
writeFileSync(
  join(DEST, '..', 'VENDORED.json'),
  JSON.stringify({ project: 'cpuminer-opt', version: '26.1', commit, source: 'https://github.com/JayDDee/cpuminer-opt' }, null, 2) + '\n',
);
console.log(`vendored cpuminer-opt ${commit} -> ${relative(process.cwd(), DEST)}`);
