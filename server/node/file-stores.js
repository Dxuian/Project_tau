// Node storage: append-only JSON-lines files in one directory.
//   shares.jsonl   every share and pool verdict (audit trail); purge() rotates it
//                  to shares.<ms>.jsonl and trims old ordinary shares from those
//   blocks.jsonl   the shares that are blocks (what payouts look up)
//   payouts.jsonl  payout entries: pending -> sent, or void
// reserve(), markSent() and void() hold an exclusive lock file, so separate
// processes sharing the directory never pay one block or spend one coin twice.
const fs = globalThis.process?.getBuiltinModule?.('node:fs');
const path = globalThis.process?.getBuiltinModule?.('node:path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readLines(file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // a torn last line after a crash
    }
  }
  return out;
}

function append(file, value) {
  const fd = fs.openSync(file, 'a', 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify(value)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

export function fileStores(dir = 'payout-ledger', { lockTimeoutMs = 10_000, settleMs = 60_000 } = {}) {
  if (!fs) throw new Error('file storage needs Node (22.3+)');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const sharesFile = path.join(dir, 'shares.jsonl');
  const blocksFile = path.join(dir, 'blocks.jsonl');
  const payoutsFile = path.join(dir, 'payouts.jsonl');
  const lockFile = path.join(dir, 'payouts.lock');

  async function locked(fn) {
    const end = Date.now() + lockTimeoutMs;
    let fd;
    for (;;) {
      try {
        fd = fs.openSync(lockFile, 'wx', 0o600);
        break;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        if (Date.now() > end) throw new Error(`${lockFile} is held (if no payout is running, delete it)`);
        await sleep(20);
      }
    }
    try {
      return fn();
    } finally {
      fs.closeSync(fd);
      fs.unlinkSync(lockFile);
    }
  }

  /** Current payout per block from the log. */
  function state() {
    const entries = new Map();
    for (const p of readLines(payoutsFile)) {
      if (p.type !== 'payout' || typeof p.blockHash !== 'string') continue;
      if (p.status === 'void') entries.delete(p.blockHash);
      else if (p.status === 'pending') entries.set(p.blockHash, p.entry);
      else if (p.status === 'sent' && entries.has(p.blockHash)) {
        entries.set(p.blockHash, { ...entries.get(p.blockHash), status: 'sent', sentTime: p.time });
      }
    }
    return entries;
  }

  const shares = {
    async add(record) {
      append(sharesFile, record);
      if (record.isBlock) append(blocksFile, record);
    },
    async addResult(result) {
      append(sharesFile, result);
    },
    async blocksFor(visitor) {
      return readLines(blocksFile).filter((r) => r.type === 'share' && r.visitor === visitor);
    },
    async claimants(blockHash) {
      return [...new Set(readLines(blocksFile).filter((r) => r.blockHash === blockHash).map((r) => r.visitor))];
    },
    async visitorsWithBlocks() {
      return [...new Set(readLines(blocksFile).map((r) => r.visitor))];
    },
  };

  const ledger = {
    async get(blockHash) {
      return state().get(blockHash) ?? null;
    },
    reserve(entry) {
      return locked(() => {
        const now = state();
        if (now.has(entry.blockHash)) return 'block-taken';
        const used = new Set([...now.values()].flatMap((e) => e.inputs));
        if (entry.inputs.some((i) => used.has(i))) return 'inputs-taken';
        append(payoutsFile, { type: 'payout', status: 'pending', blockHash: entry.blockHash, time: new Date().toISOString(), entry: { ...entry, status: 'pending' } });
        return 'reserved';
      });
    },
    markSent(blockHash, txid) {
      return locked(() => {
        const e = state().get(blockHash);
        if (!e || e.txid !== txid) throw new Error(`no pending payout ${txid} for ${blockHash}`);
        append(payoutsFile, { type: 'payout', status: 'sent', blockHash, txid, time: new Date().toISOString() });
      });
    },
    async usedInputs() {
      return new Set([...state().values()].flatMap((e) => e.inputs));
    },
    void(blockHash) {
      return locked(() => {
        const e = state().get(blockHash);
        if (!e || e.status !== 'pending') return false;
        append(payoutsFile, { type: 'payout', status: 'void', blockHash, txid: e.txid, time: new Date().toISOString() });
        return true;
      });
    },
  };
  /**
   * Drops ordinary (non-block) shares, and the pool's verdicts on them, recorded
   * before `before` (an ISO time), from the share log. blocks.jsonl and the
   * payouts are never touched. Returns how many records went.
   *
   * Appends never wait for a lock, so the current log is renamed first (new
   * lines start a fresh shares.jsonl), and a rotated log is rewritten only once
   * no write can still be landing in it (settleMs after its last change).
   */
  async function purge(before) {
    if (fs.existsSync(sharesFile) && fs.statSync(sharesFile).size > 0) fs.renameSync(sharesFile, path.join(dir, `shares.${Date.now()}.jsonl`));
    const blockShares = new Set(readLines(blocksFile).map((r) => r.id));
    let removed = 0;
    for (const name of fs.readdirSync(dir)) {
      if (!/^shares\.\d+\.jsonl$/.test(name)) continue;
      const file = path.join(dir, name);
      if (Date.now() - fs.statSync(file).mtimeMs < settleMs) continue;
      const lines = readLines(file);
      const keep = lines.filter((r) => !(r.time < before) || (r.type === 'share' ? r.isBlock : blockShares.has(r.share)));
      removed += lines.length - keep.length;
      if (keep.length === lines.length) continue;
      if (!keep.length) {
        fs.rmSync(file);
        continue;
      }
      fs.writeFileSync(`${file}.tmp`, keep.map((r) => `${JSON.stringify(r)}\n`).join(''), { mode: 0o600 });
      fs.renameSync(`${file}.tmp`, file);
    }
    return removed;
  }

  return { shares, ledger, purge };
}
