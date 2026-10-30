// Stratum job -> work -> share, through cpuminer-opt's own job code (C), with
// Bitcoin block 1 as the job: the header must be rebuilt exactly, the miner
// must find the real nonce, and the share must be formatted like cpuminer's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cmo } from '../src/wasm/api.ts';
import { BLOCK1, builtVariants, displayHash, GENESIS_HASH, loadModule, sha256d } from './helpers.ts';

const COINBASE = BLOCK1.coinbase;
const MERKLE_ROOT = BLOCK1.merkleRoot;
const BLOCK1_HASH = BLOCK1.hash;
const NONCE = BLOCK1.nonce;
const XNONCE1 = BLOCK1.xnonce1;
const NOTIFY = BLOCK1.notify('b1');
const COINB1 = NOTIFY[2] as string;
const COINB2 = NOTIFY[3] as string;

function block1Header(nonce = NONCE): Buffer {
  const h = Buffer.alloc(80);
  h.writeUInt32LE(1, 0);
  Buffer.from(GENESIS_HASH, 'hex').reverse().copy(h, 4);
  Buffer.from(MERKLE_ROOT, 'hex').reverse().copy(h, 36);
  h.writeUInt32LE(1231469665, 68);
  h.writeUInt32LE(0x1d00ffff, 72);
  h.writeUInt32LE(nonce, 76);
  return h;
}

test('block 1 fixtures are consistent (node:crypto)', () => {
  assert.equal(Buffer.from(sha256d(Buffer.from(COINBASE, 'hex'))).reverse().toString('hex'), MERKLE_ROOT);
  assert.equal(Buffer.from(sha256d(block1Header())).reverse().toString('hex'), BLOCK1_HASH);
  assert.equal(COINB1 + XNONCE1 + '00000000' + COINB2, COINBASE);
});

for (const v of builtVariants()) {
  test(`[${v}] block 1 job: header, nonce and submit`, async () => {
    const cmo = await Cmo.create(loadModule(v));
    assert.equal(cmo.init(cmo.resolve('sha256d')!.id, { threadInit: true }), 0);
    cmo.setUser('bc1qtestuser');
    assert.ok(cmo.subscribed(XNONCE1, 4));
    cmo.setDifficulty(1);
    assert.ok(cmo.notify(NOTIFY));
    const seq = cmo.genWork();
    assert.ok(seq > 0);

    // Header words must be exactly block 1's header (BE32 of its bytes).
    const data = cmo.workData(seq);
    const header = block1Header(0);
    for (let i = 0; i < 19; i++) assert.equal(data[i], header.readUInt32BE(i * 4), `header word ${i}`);
    assert.equal(data[20], 0x80000000);
    assert.equal(data[31], 0x280);

    // Pool-standard difficulty-1 target.
    const target = cmo.workTarget(seq);
    assert.deepEqual([...target], [0, 0, 0, 0, 0, 0, 0xffff0000, 0]);
    assert.equal(cmo.workTargetDiff(seq), 1);
    assert.equal(cmo.workJobId(seq), 'b1');

    // Scan a window around the real nonce (data[19] holds the header's nonce bytes as BE32).
    const nonceWord = block1Header().readUInt32BE(76); // 0x01e36299 for nonce 0x9962e301
    cmo.setScanWork(data, target);
    cmo.scan(nonceWord - 300, nonceWord + 300);
    const sols = cmo.solutions();
    assert.equal(sols.length, 1);
    assert.equal(displayHash(sols[0].hash), BLOCK1_HASH);

    const submit = JSON.parse(cmo.buildSubmit(seq, sols[0].data)!);
    assert.equal(submit.method, 'mining.submit');
    assert.deepEqual(submit.params, ['bc1qtestuser', 'b1', '00000000', '4966bc61', '9962e301']);

    // The next work of the same job uses the next extranonce2 (little-endian counter).
    const seq2 = cmo.genWork();
    const sub2 = JSON.parse(cmo.buildSubmit(seq2, cmo.workData(seq2))!);
    assert.equal(sub2.params[2], '01000000');
    assert.notEqual(cmo.workData(seq2)[9], data[9], 'merkle root changes with extranonce2');
  });

  test(`[${v}] difficulty to target`, async () => {
    const cmo = await Cmo.create(loadModule(v));
    const t = (d: number) => [...cmo.diffToTarget(d)].map((w) => w.toString(16).padStart(8, '0')).reverse().join('');
    assert.equal(t(1), '00000000ffff' + '0'.repeat(52));
    assert.equal(t(2), '000000007fff8' + '0'.repeat(51));
    assert.equal(t(0.5), '00000001fffe' + '0'.repeat(52));
    assert.equal(t(1 / 65536), '0000ffff' + '0'.repeat(56));
    assert.equal(t(1024), '00000000003fffc' + '0'.repeat(49));
  });

  test(`[${v}] set_difficulty applies at the next notify; bad notify keeps the job`, async () => {
    const cmo = await Cmo.create(loadModule(v));
    assert.equal(cmo.init(cmo.resolve('sha256d')!.id), 0);
    cmo.setUser('u');
    cmo.subscribed(XNONCE1, 4);
    cmo.setDifficulty(8);
    assert.ok(cmo.notify(NOTIFY));
    cmo.setDifficulty(16);
    assert.equal(cmo.workTargetDiff(cmo.genWork()), 8);
    assert.equal(cmo.notify(['bad', 'xx']), false);
    assert.equal(cmo.workJobId(cmo.genWork()), 'b1');
    assert.ok(cmo.notify([...NOTIFY.slice(0, 8), false].map((x, i) => (i === 0 ? 'b2' : x))));
    const seq = cmo.genWork();
    assert.equal(cmo.workTargetDiff(seq), 16);
    assert.equal(cmo.workJobId(seq), 'b2');
  });
}
