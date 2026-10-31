// The share auditor: a bridge interceptor that makes found blocks provable.
// Per connection it lets through only the stratum messages a miner needs
// (re-serialized from the parsed JSON), binds the connection to the payout
// address of its first authorize while logging in to the pool as `poolUser`,
// remembers the jobs the pool sends with the extranonce1 in effect, and records
// every submitted share (raw fields + whether it is a block) before forwarding it.
import { isHex } from '../wallet/bytes.ts';
import { addressScript, isValidAddress, type NetworkName } from '../wallet/keys.ts';
import { coinbaseOutputs, paidTo, rebuildBlockHeader, type JobFields } from './block.ts';
import type { ShareRecord, ShareResult } from './stores.ts';
import type { BridgeConnection, BridgeInterceptor } from '../bridge/core.ts';

export interface ShareAuditorOptions {
  /** Address every visitor is logged in to the pool as: block rewards go to it. */
  poolUser: string;
  network?: NetworkName;
  /** Stores a share; awaited before the share is forwarded to the pool. */
  onShare: (record: ShareRecord) => void | Promise<void>;
  /** The pool's verdict on a share. */
  onResult?: (result: ShareResult) => void | Promise<void>;
  log?: (line: string) => void;
  /** Per connection (default 50). */
  maxSharesPer10s?: number;
}

const MAX_LINE = 16 * 1024;
const MAX_JOBS = 32;
const MAX_PENDING = 64;

interface Job extends JobFields {
  jobId: string;
  clean: boolean;
  xn1: string;
  xn2Size: number;
  ownerSats: bigint | null;
}

function validNotify(p: unknown): Omit<Job, 'xn1' | 'xn2Size' | 'ownerSats'> | null {
  if (!Array.isArray(p) || p.length < 9) return null;
  const [jobId, prevhash, coinb1, coinb2, merkle, version, nbits, , clean] = p;
  if (typeof jobId !== 'string' || !jobId || jobId.length > 128) return null;
  if (!isHex(prevhash, 32) || !isHex(version, 4) || !isHex(nbits, 4) || !isHex(p[7], 4)) return null;
  if (!isHex(coinb1) || !isHex(coinb2) || coinb1.length + coinb2.length > 40_000) return null;
  if (!Array.isArray(merkle) || merkle.length > 32 || !merkle.every((m) => isHex(m, 32))) return null;
  return { jobId, prevhash, coinb1, coinb2, merkle, version, nbits, clean: clean === true };
}

function randomTag(): string {
  const b = new Uint8Array(4);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function createShareAuditor(options: ShareAuditorOptions): (connection: BridgeConnection) => BridgeInterceptor {
  const { poolUser, network = 'mainnet', onShare, onResult, log = () => {}, maxSharesPer10s = 50 } = options;
  const ownerScript = addressScript(poolUser, network);
  if (typeof onShare !== 'function') throw new Error('onShare is required');
  const started = `${Date.now().toString(36)}${randomTag()}`;

  return (connection) => {
    let visitor: string | null = null;
    let xn1: string | null = null;
    let xn2Size = 0;
    let difficulty: number | null = null;
    let shareCount = 0;
    const jobs = new Map<string, Job>();
    const pending = new Map<string, { kind: string; shareId?: string }>();
    const recent: number[] = [];

    const deny = (id: unknown, message: string, code = 20): null => {
      if (id !== undefined && id !== null) connection.reply(JSON.stringify({ id, result: null, error: [code, message, null] }));
      return null;
    };
    const idKey = (id: unknown) => `${typeof id}:${id}`;

    const fromClient = async (line: string): Promise<string | null> => {
      if (line.length > MAX_LINE) return null;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        return null;
      }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
      const { id, method, params } = msg;
      if (method === undefined) {
        // A reply to one of the pool's requests (client.get_version, mining.ping...).
        return 'result' in msg || 'error' in msg ? JSON.stringify(msg) : null;
      }
      const validId = (typeof id === 'number' && Number.isSafeInteger(id)) || (typeof id === 'string' && id.length <= 64);
      if (!validId) return null;
      if (typeof method !== 'string' || !Array.isArray(params)) return deny(id, 'invalid request');
      if (pending.has(idKey(id))) return deny(id, 'duplicate request id');
      if (pending.size >= MAX_PENDING) return deny(id, 'too many requests in flight');
      const forward = (kind: string, newParams: unknown[], shareId?: string) => {
        pending.set(idKey(id), { kind, shareId });
        return JSON.stringify({ id, method, params: newParams });
      };

      switch (method) {
        case 'mining.subscribe':
          return forward('subscribe', params.filter((p: unknown) => typeof p === 'string' && p.length <= 128).slice(0, 2));
        case 'mining.extranonce.subscribe':
          return forward('extranonce', []);
        case 'mining.authorize': {
          const address = typeof params[0] === 'string' ? params[0].trim() : '';
          if (!isValidAddress(address, network)) return deny(id, `invalid payout address: expected a ${network} Bitcoin address`, 24);
          if (visitor && visitor !== address) return deny(id, 'one payout address per connection', 24);
          visitor = address;
          return forward('authorize', [poolUser, typeof params[1] === 'string' ? params[1].slice(0, 64) : 'x']);
        }
        case 'mining.submit': {
          if (!visitor) return deny(id, 'unauthorized worker', 24);
          if (params.length !== 5) return deny(id, 'version rolling is not supported');
          const [, jobId, xn2, ntime, nonce] = params;
          const job = typeof jobId === 'string' ? jobs.get(jobId) : undefined;
          if (!job) return deny(id, 'Job not found', 21);
          if (!isHex(xn2, job.xn2Size) || !isHex(ntime, 4) || !isHex(nonce, 4)) return deny(id, 'invalid share fields');
          const now = Date.now();
          while (recent.length && now - recent[0] > 10_000) recent.shift();
          if (recent.length >= maxSharesPer10s) return deny(id, 'too many shares');
          recent.push(now);
          const share = { xn1: job.xn1, xn2: xn2.toLowerCase(), ntime: ntime.toLowerCase(), nonce: nonce.toLowerCase() };
          const rebuilt = rebuildBlockHeader({ ...job, ...share });
          const shareId = `${started}-${connection.id}-${++shareCount}`;
          const record: ShareRecord = {
            type: 'share',
            v: 1,
            id: shareId,
            time: new Date(now).toISOString(),
            conn: connection.id,
            peer: connection.peer,
            visitor,
            jobId,
            job: { prevhash: job.prevhash, coinb1: job.coinb1, coinb2: job.coinb2, merkle: job.merkle, version: job.version, nbits: job.nbits },
            ...share,
            difficulty,
            blockHash: rebuilt.blockHash,
            isBlock: rebuilt.isBlock,
            ownerSats: job.ownerSats === null ? null : String(job.ownerSats),
          };
          // Stored before the pool sees it: a block can't be found without its record.
          await onShare(record);
          if (rebuilt.isBlock) log(`block candidate ${rebuilt.blockHash} from ${visitor} (connection ${connection.id})`);
          return forward('submit', [poolUser, jobId, share.xn2, share.ntime, share.nonce], shareId);
        }
        default:
          return deny(id, `unsupported method ${method.slice(0, 64)}`);
      }
    };

    const fromPool = (line: string): string | null => {
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        return line;
      }
      if (!msg || typeof msg !== 'object') return line;
      if (msg.method === 'mining.notify') {
        const job = validNotify(msg.params);
        if (job && xn1 !== null) {
          let ownerSats: bigint | null = null;
          try {
            ownerSats = paidTo(coinbaseOutputs(job.coinb1 + xn1 + '00'.repeat(xn2Size) + job.coinb2), ownerScript);
          } catch {
            // not a parsable coinbase: shares on it can never be paid
          }
          if (job.clean) jobs.clear();
          jobs.delete(job.jobId);
          jobs.set(job.jobId, { ...job, xn1, xn2Size, ownerSats });
          while (jobs.size > MAX_JOBS) jobs.delete(jobs.keys().next().value as string);
        }
      } else if (msg.method === 'mining.set_extranonce') {
        const [x1, size] = Array.isArray(msg.params) ? msg.params : [];
        // Applies to the jobs that follow, as on the miner.
        if (isHex(x1) && x1.length <= 32 && Number.isInteger(size) && size >= 2 && size <= 16) {
          xn1 = x1.toLowerCase();
          xn2Size = size;
        }
      } else if (msg.method === 'mining.set_difficulty') {
        const d = Array.isArray(msg.params) ? msg.params[0] : undefined;
        if (typeof d === 'number' && Number.isFinite(d) && d > 0) difficulty = d;
      } else if (msg.method === 'client.reconnect') {
        return null; // visitors stay on this bridge's pool
      } else if (msg.method === undefined && msg.id !== undefined && msg.id !== null) {
        const asked = pending.get(idKey(msg.id));
        if (asked) {
          pending.delete(idKey(msg.id));
          if (asked.kind === 'subscribe' && Array.isArray(msg.result)) {
            const [, x1, size] = msg.result;
            if (isHex(x1) && x1.length <= 32 && Number.isInteger(size) && size >= 2 && size <= 16) {
              xn1 = x1.toLowerCase();
              xn2Size = size;
            }
          } else if (asked.kind === 'submit' && onResult && asked.shareId) {
            const result: ShareResult = {
              type: 'result',
              v: 1,
              share: asked.shareId,
              time: new Date().toISOString(),
              accepted: msg.result === true,
              error: msg.error ?? null,
            };
            Promise.resolve()
              .then(() => onResult(result))
              .catch((err) => log(`recording a share result failed: ${(err as Error).message}`));
          }
        }
      }
      return line;
    };

    return { fromClient, fromPool };
  };
}
