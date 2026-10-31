// A minimal stratum pool over a regtest bitcoind (tests only): jobs from
// getblocktemplate with a coinbase paying the address that authorized, and
// shares that are blocks go to submitblock.
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { rebuildBlockHeader } from '../tau-crypto/dist/payouts.js';
import { addressScript } from '../tau-crypto/dist/wallet.js';

const h8 = (n) => n.toString(16).padStart(2, '0');
const le = (n, bytes) => {
  const b = Buffer.alloc(bytes);
  if (bytes === 8) b.writeBigUInt64LE(BigInt(n));
  else b.writeUInt32LE(n);
  return b.toString('hex');
};
const varint = (n) => (n < 0xfd ? h8(n) : `fd${le(n, 4).slice(0, 4)}`);

/** BIP34 height as the script opcode(s) Bitcoin Core expects. */
function heightPush(height) {
  if (height >= 1 && height <= 16) return h8(0x50 + height);
  const bytes = [];
  for (let n = height; n > 0; n >>= 8) bytes.push(n & 0xff);
  if (bytes[bytes.length - 1] & 0x80) bytes.push(0);
  return h8(bytes.length) + bytes.map(h8).join('');
}

/** Display hash -> stratum's prevhash (header byte order, each 4-byte word reversed). */
function stratumPrevhash(display) {
  const header = Buffer.from(display, 'hex').reverse();
  for (let i = 0; i < 32; i += 4) header.subarray(i, i + 4).reverse();
  return header.toString('hex');
}

export async function startRegtestPool({ rpc, difficulty = 0.001, xn2Size = 4 }) {
  const authorized = [];
  const submits = [];
  const found = [];
  const sockets = new Set();
  let jobSeq = 0;

  async function newJob(script) {
    const t = await rpc('getblocktemplate', [{ rules: ['segwit'] }]);
    // A coinbase-only block: leave out the template's transactions and their fees.
    const fees = t.transactions.reduce((sum, x) => sum + BigInt(x.fee), 0n);
    const tag = Buffer.from('/tau-regtest/').toString('hex');
    const height = heightPush(t.height);
    const scriptSigBytes = height.length / 2 + 1 + 4 + xn2Size + 1 + tag.length / 2;
    return {
      jobId: (++jobSeq).toString(16),
      height: t.height,
      prevhash: stratumPrevhash(t.previousblockhash),
      coinb1: '02000000' + '01' + '00'.repeat(32) + 'ffffffff' + varint(scriptSigBytes) + height + h8(4 + xn2Size),
      coinb2: h8(tag.length / 2) + tag + 'ffffffff' + '01' + le(BigInt(t.coinbasevalue) - fees, 8) + varint(script.length / 2) + script + '00000000',
      merkle: [],
      version: (t.version >>> 0).toString(16).padStart(8, '0'),
      nbits: t.bits,
      ntime: t.curtime.toString(16).padStart(8, '0'),
    };
  }

  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    const conn = { xn1: randomBytes(4).toString('hex'), script: null, jobs: new Map() };
    const send = (msg) => socket.write(`${JSON.stringify(msg)}\n`);
    const notify = async () => {
      const job = await newJob(conn.script);
      conn.jobs.clear();
      conn.jobs.set(job.jobId, job);
      send({ id: null, method: 'mining.notify', params: [job.jobId, job.prevhash, job.coinb1, job.coinb2, job.merkle, job.version, job.nbits, job.ntime, true] });
    };
    const handle = async (msg) => {
      const { id, method, params } = msg;
      if (method === 'mining.subscribe') return send({ id, result: [[['mining.notify', 'tau']], conn.xn1, xn2Size], error: null });
      if (method === 'mining.extranonce.subscribe') return send({ id, result: true, error: null });
      if (method === 'mining.authorize') {
        authorized.push(params[0]);
        try {
          conn.script = addressScript(params[0], 'regtest');
        } catch {
          return send({ id, result: false, error: [24, 'invalid address', null] });
        }
        send({ id, result: true, error: null });
        send({ id: null, method: 'mining.set_difficulty', params: [difficulty] });
        return notify();
      }
      if (method === 'mining.submit') {
        submits.push(params);
        const [user, jobId, xn2, ntime, nonce] = params;
        const job = conn.jobs.get(jobId);
        if (!job || job.taken) return send({ id, result: false, error: [21, 'Job not found', null] });
        const r = rebuildBlockHeader({ ...job, xn1: conn.xn1, xn2, ntime, nonce });
        if (!r.isBlock) return send({ id, result: true, error: null });
        job.taken = true; // one block per job; later shares on it are stale
        const verdict = await rpc('submitblock', [`${r.header}01${r.coinbase}`]);
        if (verdict !== null) return send({ id, result: false, error: [20, `block rejected: ${verdict}`, null] });
        found.push({ hash: r.blockHash, height: job.height, user });
        send({ id, result: true, error: null });
        return notify();
      }
      send({ id, result: null, error: [20, 'unsupported', null] });
    };
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.trim()) handle(JSON.parse(line)).catch((err) => console.error('regtest pool:', err));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    url: `stratum+tcp://127.0.0.1:${port}`,
    authorized,
    submits,
    found,
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
