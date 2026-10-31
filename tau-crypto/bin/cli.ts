// tau-crypto: command-line front end (Node). Mirrors cpuminer's core options.
import { benchmark, createMiner, detect, listAlgorithms } from '../src/index.ts';
import type { BackendChoice } from '../src/types.ts';

const VERSION = '0.1.0';

const USAGE = `Usage: tau-crypto [OPTIONS]
       tau-crypto bridge --listen [HOST:]PORT --allow HOST:PORT[,...] [--origin URL,...]

Mining:
  -a, --algo ALGO          algorithm (see --list-algos), e.g. sha256d, scrypt, x11
  -o, --url URL            stratum+tcp://host:port or stratum+ssl://host:port
  -u, --user USER          pool user (solo.ckpool.org: your payout address)
  -p, --pass PASS          pool password (default x)
  -t, --threads N          CPU threads (default: autotune)
      --backend NAME       force a backend (wasm-avx2, wasm-sse42, wasm-sse41,
                           wasm-sha256-x8, wasm-sha256-x4, node-crypto, js, webgpu)
      --no-gpu             don't use a GPU backend
      --throttle F         idle fraction 0..0.95 (default 0)
      --param-n N          algorithm parameter N (scrypt, yespower...)
      --param-r N          algorithm parameter R
      --param-key KEY      algorithm parameter key (yespower variants)
      --tune MODE          quick | thorough (default thorough)
      --verthash-file PATH verthash.dat location (generated if missing)
      --tls-insecure       accept any TLS certificate (cpuminer behaviour)
  -q, --quiet              only print shares and errors

Other:
      --benchmark          measure backends (and run --seconds at full width)
      --seconds N          benchmark duration at full width (default 10, 0 = skip)
      --detect             print the detected capabilities
      --list-algos         list algorithms
  -V, --version
  -h, --help
`;

interface Args {
  [k: string]: string | boolean | undefined;
}

const ALIASES: Record<string, string> = { a: 'algo', o: 'url', u: 'user', p: 'pass', t: 'threads', q: 'quiet', h: 'help', V: 'version' };
const FLAGS = new Set(['quiet', 'help', 'version', 'benchmark', 'detect', 'list-algos', 'no-gpu', 'tls-insecure']);

function parse(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    let key: string;
    let value: string | undefined;
    if (a.startsWith('--')) {
      [key, value] = a.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    } else if (a.startsWith('-') && a.length === 2) {
      key = ALIASES[a[1]];
      if (!key) throw new Error(`unknown option ${a}`);
    } else {
      throw new Error(`unexpected argument ${a}`);
    }
    if (FLAGS.has(key)) {
      out[key] = true;
      continue;
    }
    if (value === undefined) {
      value = argv[++i];
      if (value === undefined) throw new Error(`--${key} needs a value`);
    }
    out[key] = value;
  }
  return out;
}

const ts = () => new Date().toISOString().slice(11, 19);
const say = (msg: string) => console.log(`[${ts()}] ${msg}`);

function formatHps(h: number): string {
  const units = ['H/s', 'kH/s', 'MH/s', 'GH/s', 'TH/s'];
  let i = 0;
  while (h >= 1000 && i < units.length - 1) {
    h /= 1000;
    i++;
  }
  return `${h.toFixed(2)} ${units[i]}`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === 'bridge') {
    const { runBridgeCli } = await import('../src/bridge/node.ts');
    await runBridgeCli(argv.slice(1));
    return;
  }
  const args = parse(argv);
  if (args.help) return void console.log(USAGE);
  if (args.version) return void console.log(`tau-crypto ${VERSION} (cpuminer-opt 26.1)`);
  if (args.detect) return void console.log(JSON.stringify(await detect(), null, 2));
  if (args['list-algos']) {
    for (const a of listAlgorithms()) {
      const aliases = a.aliases.length ? ` (${a.aliases.join(', ')})` : '';
      console.log(`${a.name.padEnd(14)} ${a.status.padEnd(20)}${aliases}${a.notes ? `  ${a.notes}` : ''}`);
    }
    return;
  }

  const algo = (args.algo as string) ?? 'sha256d';
  const params = {
    n: args['param-n'] ? Number(args['param-n']) : undefined,
    r: args['param-r'] ? Number(args['param-r']) : undefined,
    key: args['param-key'] as string | undefined,
  };
  const common = {
    backend: (args.backend as BackendChoice | undefined) ?? 'auto',
    threads: args.threads ? Number(args.threads) : ('auto' as const),
    gpu: !args['no-gpu'],
    mode: (args.tune as 'quick' | 'thorough' | undefined) ?? 'thorough',
    verthashFile: args['verthash-file'] as string | undefined,
    log: args.quiet ? undefined : say,
  };

  if (args.benchmark) {
    const seconds = args.seconds !== undefined ? Number(args.seconds) : 10;
    say(`benchmarking ${algo}...`);
    const r = await benchmark({ algo, params, seconds, ...common });
    console.log('\nbackend           H/s per thread    memory      note');
    for (const m of r.plan.measurements) {
      const mem = m.memoryBytes ? `${(m.memoryBytes / 1048576).toFixed(0)} MiB` : '-';
      console.log(`${m.backend.padEnd(17)} ${m.hps ? formatHps(m.hps).padEnd(17) : '-'.padEnd(17)} ${mem.padEnd(11)} ${m.error ?? ''}`);
    }
    const p = r.plan;
    console.log(
      `\nchosen: ${p.cpu ? `${p.cpu.backend} x ${p.cpu.threads} threads` : 'no CPU'}${p.gpu ? ' + webgpu' : ''}` +
        ` (expected ${formatHps(p.expectedHps)})`,
    );
    if (r.totalHps !== null) console.log(`measured at full width for ${seconds} s: ${formatHps(r.totalHps)}`);
    return;
  }

  if (!args.url || !args.user) throw new Error('--url and --user are required (see --help)');
  const miner = await createMiner({
    algo,
    params,
    url: args.url as string,
    user: args.user as string,
    pass: (args.pass as string) ?? 'x',
    throttle: args.throttle ? Number(args.throttle) : 0,
    tlsInsecure: !!args['tls-insecure'],
    ...common,
  });
  if (!args.quiet) miner.on('log', say);
  miner.on('error', (e) => say(`error: ${e.message}`));
  miner.on('job', (j) => !args.quiet && say(`job ${j.jobId} block ${j.height} target diff ${j.difficulty.toPrecision(5)}`));
  miner.on('share', (s) => {
    const st = miner.stats();
    const verdict = s.accepted ? 'Accepted' : s.stale ? 'Stale' : 'Rejected';
    say(`${verdict} ${st.accepted}/${st.accepted + st.rejected + st.stale} diff ${s.shareDiff.toPrecision(5)}${s.reason ? ` (${s.reason})` : ''}`);
  });
  let n = 0;
  miner.on('hashrate', (h) => {
    if (!args.quiet && ++n % 5 === 0) say(`hashrate ${formatHps(h.hps)}`);
  });
  const stop = async () => {
    say('stopping...');
    await miner.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await miner.start();
}

main().catch((err) => {
  console.error(`tau-crypto: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
