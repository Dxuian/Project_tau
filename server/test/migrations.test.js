// The committed migrations match the Drizzle schemas: drizzle-kit, run on a
// copy of each migrations folder, finds nothing left to generate. After
// changing a schema: server/dev db generate <name>, and commit the migration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SERVER } from './helpers.js';

for (const [name, dialect, folder] of [
  ['TiDB', 'mysql', 'tidb'],
  ['D1', 'sqlite', 'cloudflare'],
]) {
  test(`${name}: ${folder}/migrations is up to date with ${folder}/schema.js`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'tau-migrations-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const committed = join(SERVER, folder, 'migrations');
    cpSync(committed, join(dir, 'migrations'), { recursive: true });
    // drizzle-kit takes --out relative to where it runs (and exits 0 on errors): run it in the copy's folder, check its output.
    const kit = join(SERVER, 'node_modules', 'drizzle-kit', 'bin.cjs');
    const r = spawnSync(process.execPath, [kit, 'generate', '--dialect', dialect, '--schema', join(SERVER, folder, 'schema.js'), '--out', './migrations'], { cwd: dir, encoding: 'utf8' });
    const output = `${r.stdout}\n${r.stderr}`;
    assert.deepEqual(readdirSync(join(dir, 'migrations')).sort(), readdirSync(committed).sort(), `${folder}/schema.js changed without a migration: run server/dev db generate <name>\n${output}`);
    assert.match(r.stdout, /No schema changes/, output);
  });
}
