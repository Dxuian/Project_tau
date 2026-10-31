// Backend 'node-crypto' (Node only): sha256d / sha256t / sha256q through
// OpenSSL, one crypto.hash call per SHA-256 pass and nonce. Per-call overhead
// dominates; the backend exists so the autotuner can measure whether
// OpenSSL's native SHA extensions still beat WASM here.
import type { AlgoSpec, Capabilities, FoundSolution, Kernel, KernelSetup, ScanJob, ScanOutcome } from '../types.ts';
import { nodeBuiltin } from '../env/detect.ts';
import { registerBackend, SHA256_FAMILY, type BackendFactory } from './registry.ts';
import { checkScanJob, makeSolution, MAX_SOLUTIONS, sha256Passes, validHash } from './sha256-js.ts';

type Bytes = Uint8Array & { readUInt32LE(offset: number): number };
type HashFn = (data: Uint8Array) => Bytes;

interface NodeCrypto {
  hash?: (algorithm: string, data: Uint8Array, outputEncoding: 'buffer') => Bytes;
  createHash(algorithm: string): { update(data: Uint8Array): { digest(): Bytes } };
}

export class NodeCryptoKernel implements Kernel {
  readonly backend = 'node-crypto' as const;
  readonly granularity = 1;
  private readonly passes: number;
  private readonly sha256: HashFn;
  private readonly header = new Uint8Array(80);
  private readonly view = new DataView(this.header.buffer);
  private readonly hash = new Uint32Array(8);

  constructor(algo: string, sha256: HashFn) {
    this.passes = sha256Passes(algo);
    this.sha256 = sha256;
  }

  scan(job: ScanJob): ScanOutcome {
    checkScanJob(job);
    const { data, target, start, end } = job;
    const { header, view, sha256, passes, hash } = this;
    for (let i = 0; i < 19; i++) view.setUint32(i * 4, data[i]);
    const t7 = target[7];
    const solutions: FoundSolution[] = [];
    for (let n = start; n < end; n++) {
      view.setUint32(76, n);
      let digest = sha256(header);
      for (let p = 1; p < passes; p++) digest = sha256(digest);
      // Word 7 (digest bytes 28..31, little-endian) decides almost every nonce.
      if (digest.readUInt32LE(28) > t7 || solutions.length >= MAX_SOLUTIONS) continue;
      for (let i = 0; i < 8; i++) hash[i] = digest.readUInt32LE(i * 4);
      if (validHash(hash, target)) solutions.push(makeSolution(job, n, hash));
    }
    return { hashesDone: end - start, solutions };
  }

  memoryBytes(): number {
    return this.header.byteLength + this.hash.byteLength;
  }

  dispose(): void {}
}

export async function createNodeCryptoKernel(setup: KernelSetup): Promise<NodeCryptoKernel> {
  if (!SHA256_FAMILY.has(setup.algo.name)) throw new Error(`node-crypto backend does not implement ${setup.algo.name}`);
  const crypto = await nodeBuiltin<NodeCrypto>('crypto');
  // crypto.hash (Node >= 21.7) is a one-shot call, faster than createHash.
  const one = crypto.hash;
  const sha256: HashFn =
    typeof one === 'function'
      ? (b) => one('sha256', b, 'buffer')
      : (b) => crypto.createHash('sha256').update(b).digest();
  return new NodeCryptoKernel(setup.algo.name, sha256);
}

export const nodeCryptoBackend: BackendFactory = {
  name: 'node-crypto',
  kind: 'cpu',
  priority: 40,
  unsupported(algo: AlgoSpec, caps: Capabilities): string | null {
    if (!caps.nodeCrypto) return 'node:crypto is not available';
    return SHA256_FAMILY.has(algo.name) ? null : `node-crypto implements ${[...SHA256_FAMILY].join(', ')} only`;
  },
  create: createNodeCryptoKernel,
};

registerBackend(nodeCryptoBackend);
