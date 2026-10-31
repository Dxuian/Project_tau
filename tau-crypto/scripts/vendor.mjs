// Fetches the pinned cpuminer-opt commit into the cache volume (a git clone,
// kept for the next run) and copies its sources into native/vendor/cpuminer-opt,
// recording the commit. Runs inside the dev container: ./dev vendor
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';

const SOURCE = 'https://github.com/JayDDee/cpuminer-opt';
const PINNED_COMMIT = 'b34565bfaca5da9ed894a326e3ba0dfe459550a4'; // v26.1
const UPSTREAM = join(process.env.CMO_CACHE ?? '/cache', 'upstream', 'cpuminer-opt');
const DEST = new URL('../native/vendor/cpuminer-opt', import.meta.url).pathname;

// Not needed for the WASM build or the reference harness.
const SKIP = new Set(['.git', 'junk', 'res', 'api', 'CLAUDE.md', 'configure~', 'Dockerfile']);

const git = (...args) => execFileSync('git', ['-c', 'safe.directory=*', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

if (!existsSync(join(UPSTREAM, '.git'))) {
  console.log(`cloning ${SOURCE} into the cache volume`);
  mkdirSync(join(UPSTREAM, '..'), { recursive: true });
  try {
    git('clone', '--quiet', SOURCE, UPSTREAM);
  } catch {
    console.error(
      `could not clone ${SOURCE}. Behind a proxy that intercepts TLS, git in the container needs that proxy's CA ` +
        '(GIT_SSL_CAINFO); TLS verification stays on. The vendored sources in native/vendor are already committed.',
    );
    process.exit(1);
  }
}
git('-C', UPSTREAM, 'checkout', '--quiet', '--detach', PINNED_COMMIT);
git('-C', UPSTREAM, 'reset', '--quiet', '--hard', PINNED_COMMIT);
git('-C', UPSTREAM, 'clean', '--quiet', '-fdx');
const commit = git('-C', UPSTREAM, 'rev-parse', 'HEAD');
if (commit !== PINNED_COMMIT) {
  console.error(`upstream is at ${commit}, expected ${PINNED_COMMIT} (v26.1)`);
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
  JSON.stringify({ project: 'cpuminer-opt', version: '26.1', commit, source: SOURCE }, null, 2) + '\n',
);
console.log(`vendored cpuminer-opt ${commit} -> ${relative(process.cwd(), DEST)}`);
