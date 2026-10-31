// The share auditor (src/payouts/auditor.ts): what it forwards, rewrites, refuses and records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShareAuditor, type ShareAuditorOptions } from '../src/payouts/auditor.ts';
import type { BridgeConnection } from '../src/bridge/core.ts';
import { coinbaseOutputs, rebuildBlockHeader } from '../src/payouts/index.ts';
import type { ShareRecord, ShareResult } from '../src/payouts/index.ts';
import { addressScript, createWallet, newAddress, walletFromMnemonic } from '../src/wallet/index.ts';

// Bitcoin block 1 as a stratum job (its coinbase's zero prevout holds xn1 + xn2).
const B1_COINBASE =
  '01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff' +
  '0704ffff001d0104ffffffff0100f2052a0100000043410496b538e853519c726a2c91e61ec11600ae1390' +
  '813a627c66fb8be7947be63c52da7589379515d4e0a604f8141781e62294721166bf621e73a82cbf2342c858eeac00000000';
const B1 = {
  prevhash: '0a8ce26f72b3f1b646a2a6c14ff763ae65831e939c085ae10019d66800000000',
  coinb1: B1_COINBASE.slice(0, 26),
  coinb2: B1_COINBASE.slice(42),
  merkle: [],
  version: '00000001',
  nbits: '1d00ffff',
  ntime: '4966bc61',
};
const B1_HASH = '00000000839a8e6886ab5951d76f411475428afc90947ee320161bbf18eb6048';
const B1_TXID = '0e3e2357e806b6cdb1f70b54c3a3a17b6714ee1f0e68bebb44a74b1efd512098';
const OWNER = walletFromMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about').address;

function notify(jobId: string, job: typeof B1 = B1, clean = true) {
  return JSON.stringify({ id: null, method: 'mining.notify', params: [jobId, job.prevhash, job.coinb1, job.coinb2, job.merkle, job.version, job.nbits, job.ntime, clean] });
}

/** One audited connection, already subscribed (xn1 00000000, xn2 size 4). */
async function connection(options: { maxSharesPer10s?: number; subscribe?: boolean; poolUser?: ShareAuditorOptions['poolUser'] } = {}) {
  const records: (ShareRecord | ShareResult)[] = [];
  const replies: any[] = [];
  const conn: BridgeConnection = {
    id: 7,
    peer: '203.0.113.5:4444',
    target: 'pool:3333',
    tls: false,
    origin: null,
    query: new URLSearchParams(),
    reply: (l) => replies.push(JSON.parse(l)),
    close() {},
  };
  const audit = createShareAuditor({
    poolUser: options.poolUser ?? OWNER,
    onShare: async (r) => {
      await new Promise((resolve) => setTimeout(resolve, 1)); // an async store
      records.push(r);
    },
    onResult: (r) => {
      records.push(r);
    },
    maxSharesPer10s: options.maxSharesPer10s,
  })(conn);
  const client = async (msg: unknown): Promise<any> => {
    const out = await audit.fromClient!(typeof msg === 'string' ? msg : JSON.stringify(msg));
    return out === null ? null : JSON.parse(out);
  };
  const pool = (msg: unknown) => audit.fromPool!(typeof msg === 'string' ? msg : JSON.stringify(msg)) as string | null;
  if (options.subscribe !== false) {
    await client({ id: 1, method: 'mining.subscribe', params: ['tau-crypto/0.1'] });
    pool({ id: 1, result: [[['mining.notify', 's']], '00000000', 4], error: null });
  }
  return { client, pool, records: records as any[], replies };
}

const visitor = createWallet().address;

test('rebuildBlockHeader reproduces Bitcoin block 1', async () => {
  const r = rebuildBlockHeader({ ...B1, xn1: '00000000', xn2: '00000000', nonce: '9962e301' });
  assert.equal(r.blockHash, B1_HASH);
  assert.equal(r.coinbaseTxid, B1_TXID); // its only transaction, so also the merkle root
  assert.equal(r.coinbase, B1_COINBASE);
  assert.equal(r.isBlock, true);
  assert.equal(rebuildBlockHeader({ ...B1, xn1: '00000000', xn2: '00000000', nonce: '9962e302' }).isBlock, false);
  // The output script as mempool.space reports it for block 1's coinbase.
  const p2pk =
    '410496b538e853519c726a2c91e61ec11600ae1390813a627c66fb8be7947be63c52da7589379515d4e0a604f8141781e62294721166bf621e73a82cbf2342c858eeac';
  assert.deepEqual(coinbaseOutputs(B1_COINBASE), [{ value: 5000000000n, script: p2pk }]);
});

test('logs in as the owner, binds the visitor and records the share as a block', async () => {
  const { client, pool, records } = await connection();
  assert.deepEqual((await client({ id: 2, method: 'mining.authorize', params: [visitor, 'x'] })).params, [OWNER, 'x']);
  pool({ id: 2, result: true, error: null });
  pool(notify('b1'));
  const sent = await client({ id: 4, method: 'mining.submit', params: [visitor, 'b1', '00000000', '4966bc61', '9962e301'] });
  assert.deepEqual(sent.params, [OWNER, 'b1', '00000000', '4966bc61', '9962e301']);
  assert.equal(records.length, 1);
  const r = records[0];
  assert.equal(r.type, 'share');
  assert.equal(r.visitor, visitor);
  assert.equal(r.blockHash, B1_HASH);
  assert.equal(r.isBlock, true);
  assert.equal(r.xn1, '00000000');
  assert.equal(r.ownerSats, '0'); // block 1 pays someone else
  pool({ id: 4, result: true, error: null });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual([records[1].type, records[1].share, records[1].accepted], ['result', r.id, true]);
});

test('an ordinary share is recorded but is not a block', async () => {
  const { client, pool, records } = await connection();
  await client({ id: 2, method: 'mining.authorize', params: [visitor, 'x'] });
  pool(notify('b1'));
  await client({ id: 4, method: 'mining.submit', params: [visitor, 'b1', '00000000', '4966bc61', '12345678'] });
  assert.equal(records[0].isBlock, false);
});

test('refuses submits before authorize, for unknown jobs, with bad fields or version bits', async () => {
  const { client, pool, records, replies } = await connection();
  assert.equal(await client({ id: 3, method: 'mining.submit', params: [visitor, 'b1', '00000000', '4966bc61', '9962e301'] }), null);
  await client({ id: 2, method: 'mining.authorize', params: [visitor, 'x'] });
  pool(notify('b1'));
  assert.equal(await client({ id: 5, method: 'mining.submit', params: [visitor, 'nope', '00000000', '4966bc61', '9962e301'] }), null);
  assert.equal(await client({ id: 6, method: 'mining.submit', params: [visitor, 'b1', '0000', '4966bc61', '9962e301'] }), null);
  assert.equal(await client({ id: 7, method: 'mining.submit', params: [visitor, 'b1', '00000000', '4966bc61', '9962e301', '20000000'] }), null);
  assert.equal(await client({ id: 8, method: 'mining.submit', params: [visitor, 'b1', '00000000', 'zz66bc61', '9962e301'] }), null);
  assert.deepEqual(
    replies.map((r) => [r.id, r.error[1]]),
    [
      [3, 'unauthorized worker'],
      [5, 'Job not found'],
      [6, 'invalid share fields'],
      [7, 'version rolling is not supported'],
      [8, 'invalid share fields'],
    ],
  );
  assert.equal(records.length, 0);
});

test('one payout address per connection, and only valid ones', async () => {
  const { client, replies } = await connection();
  assert.equal(await client({ id: 2, method: 'mining.authorize', params: ['not-an-address', 'x'] }), null);
  assert.equal(await client({ id: 3, method: 'mining.authorize', params: ['tb1qcr8te4kr609gcawutmrza0j4xv80jy8zq3m2pu', 'x'] }), null);
  assert.ok(await client({ id: 4, method: 'mining.authorize', params: [visitor, 'x'] }));
  assert.equal(await client({ id: 5, method: 'mining.authorize', params: [OWNER, 'x'] }), null);
  assert.ok(await client({ id: 6, method: 'mining.authorize', params: [visitor, 'x'] }));
  assert.deepEqual(replies.map((r) => r.id), [2, 3, 5]);
});

test('drops or refuses everything else', async () => {
  const { client, pool, replies } = await connection();
  assert.equal(await client('not json'), null);
  assert.equal(await client('[1,2]'), null);
  assert.equal(await client({ id: {}, method: 'mining.subscribe', params: [] }), null);
  assert.equal(await client({ id: 9, method: 'mining.configure', params: [['version-rolling'], {}] }), null);
  assert.equal(await client({ id: 10, method: 'mining.suggest_difficulty', params: [1] }), null);
  assert.equal(await client({ id: 11, method: 'eval', params: [] }), null);
  assert.equal(await client({ id: 12, method: 'mining.authorize', params: 'x' }), null);
  assert.equal(await client('x'.repeat(20_000)), null);
  assert.deepEqual(replies.map((r) => r.id), [9, 10, 11, 12]);
  // Replies to the pool's own requests pass, re-serialized.
  assert.deepEqual(await client('{"id":77,"result":"pong","error":null}'), { id: 77, result: 'pong', error: null });
  // A duplicate id while the first request is pending.
  assert.ok(await client({ id: 20, method: 'mining.extranonce.subscribe', params: [] }));
  assert.equal(await client({ id: 20, method: 'mining.extranonce.subscribe', params: [] }), null);
  // client.reconnect from the pool never reaches the visitor.
  assert.equal(pool({ id: null, method: 'client.reconnect', params: ['evil.example', 3333] }), null);
});

test('duplicate JSON keys: the pool gets exactly what was checked', async () => {
  const { client, pool, records } = await connection();
  await client({ id: 2, method: 'mining.authorize', params: [visitor, 'x'] });
  pool(notify('b1'));
  const sent = await client(`{"id":4,"method":"mining.submit","params":["x","b1","00000000","4966bc61","00000000"],"params":["${visitor}","b1","00000000","4966bc61","9962e301"]}`);
  assert.deepEqual(sent.params, [OWNER, 'b1', '00000000', '4966bc61', '9962e301']);
  assert.equal(records[0].nonce, '9962e301');
});

test('jobs keep the extranonce1 they were sent with; clean jobs drop older ones', async () => {
  const { client, pool, records } = await connection();
  await client({ id: 2, method: 'mining.authorize', params: [visitor, 'x'] });
  pool(notify('a'));
  pool({ id: null, method: 'mining.set_extranonce', params: ['11111111', 4] });
  await client({ id: 3, method: 'mining.submit', params: [visitor, 'a', '00000000', '4966bc61', '9962e301'] });
  assert.equal(records[0].xn1, '00000000');
  assert.equal(records[0].blockHash, B1_HASH);
  pool(notify('b', B1, false));
  await client({ id: 4, method: 'mining.submit', params: [visitor, 'b', '00000000', '4966bc61', '9962e301'] });
  assert.equal(records[1].xn1, '11111111');
  pool(notify('c', B1, true));
  assert.equal(await client({ id: 5, method: 'mining.submit', params: [visitor, 'a', '00000000', '4966bc61', '9962e301'] }), null);
});

test('rate-limits submits', async () => {
  const { client, pool, records } = await connection({ maxSharesPer10s: 3 });
  await client({ id: 2, method: 'mining.authorize', params: [visitor, 'x'] });
  pool(notify('b1'));
  const results: boolean[] = [];
  for (let i = 0; i < 5; i++) results.push((await client({ id: 10 + i, method: 'mining.submit', params: [visitor, 'b1', '00000000', '4966bc61', `0000000${i}`] })) !== null);
  assert.deepEqual(results, [true, true, true, false, false]);
  assert.equal(records.length, 3);
});

test("counts the satoshis a job's coinbase pays the owner", async () => {
  const ownerScript = '0014c0cebcd6c3d3ca8c75dc5ec62ebe55330ef910e2';
  // version | 1 input | null prevout | scriptSig (03 + height, then 8 bytes of extranonce) | sequence | 2 outputs | locktime
  const coinb1 = '02000000' + '01' + '00'.repeat(32) + 'ffffffff' + '0c' + '03a08601';
  const coinb2 = 'ffffffff' + '02' + '00e1f50500000000' + '16' + ownerScript + '1027000000000000' + '0151' + '00000000';
  const { client, pool, records } = await connection();
  await client({ id: 2, method: 'mining.authorize', params: [visitor, 'x'] });
  pool(notify('j', { ...B1, coinb1, coinb2 }));
  await client({ id: 3, method: 'mining.submit', params: [visitor, 'j', '00000000', '4966bc61', '00000000'] });
  assert.equal(records[0].ownerSats, '100000000');
});

const ABANDON_WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const SLOT7 = newAddress({ mnemonic: ABANDON_WORDS }, { index: 7 }).address;

test('a poolUser function logs each connection in as its own address, recorded with the share', async () => {
  const calls: string[] = [];
  const { client, pool, records } = await connection({
    poolUser: ({ visitor: v, connection: c }) => {
      calls.push(`${v}@${c.id}`);
      return { address: SLOT7, index: 7 };
    },
  });
  assert.deepEqual((await client({ id: 2, method: 'mining.authorize', params: [visitor, 'x'] })).params, [SLOT7, 'x']);
  // Asked once per connection: authorizing again keeps the same login.
  assert.deepEqual((await client({ id: 3, method: 'mining.authorize', params: [visitor, 'x'] })).params, [SLOT7, 'x']);
  assert.deepEqual(calls, [`${visitor}@7`]);
  pool(notify('b1'));
  const sent = await client({ id: 4, method: 'mining.submit', params: [visitor, 'b1', '00000000', '4966bc61', '9962e301'] });
  assert.equal(sent.params[0], SLOT7);
  assert.deepEqual([records[0].visitor, records[0].poolUser, records[0].ownerIndex], [visitor, SLOT7, 7]);
});

test("ownerSats counts what the coinbase pays the connection's own login", async () => {
  const slotScript = addressScript(SLOT7);
  const coinb1 = '02000000' + '01' + '00'.repeat(32) + 'ffffffff' + '0c' + '03a08601';
  const coinb2 = 'ffffffff' + '01' + '00e1f50500000000' + '16' + slotScript + '00000000';
  const { client, pool, records } = await connection({ poolUser: () => ({ address: SLOT7, index: 7 }) });
  await client({ id: 2, method: 'mining.authorize', params: [visitor, 'x'] });
  pool(notify('j', { ...B1, coinb1, coinb2 }));
  await client({ id: 3, method: 'mining.submit', params: [visitor, 'j', '00000000', '4966bc61', '00000000'] });
  assert.equal(records[0].ownerSats, '100000000');
});

test('a fixed login records no index; a failing or invalid login refuses the authorize', async () => {
  const fixed = await connection();
  await fixed.client({ id: 2, method: 'mining.authorize', params: [visitor, 'x'] });
  fixed.pool(notify('b1'));
  await fixed.client({ id: 3, method: 'mining.submit', params: [visitor, 'b1', '00000000', '4966bc61', '9962e301'] });
  assert.equal(fixed.records[0].poolUser, OWNER);
  assert.ok(!('ownerIndex' in fixed.records[0]));

  for (const poolUser of [
    () => {
      throw new Error('no key');
    },
    () => ({ address: 'not an address' }),
    () => ({ address: SLOT7, index: -1 }),
    async () => Promise.reject(new Error('store down')),
  ]) {
    const c = await connection({ poolUser });
    assert.equal(await c.client({ id: 2, method: 'mining.authorize', params: [visitor, 'x'] }), null);
    assert.deepEqual(c.replies.at(-1).error, [20, 'mining is unavailable right now', null]);
    assert.equal(await c.client({ id: 3, method: 'mining.submit', params: [visitor, 'b1', '00000000', '4966bc61', '9962e301'] }), null);
    assert.equal(c.replies.at(-1).error[1], 'unauthorized worker');
  }
});
