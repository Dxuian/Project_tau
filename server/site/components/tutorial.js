'use client';
// The visitor's tutorial: how Bitcoin mining works, in plain words for someone new
// to it. It opens by itself on a first visit (until it's closed once: useTutorial),
// and again from "See tutorial" on the miner. Its pictures use the theme's tokens.
import { gsap } from 'gsap';
import { KeyRoundIcon, MailIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const LINE = { className: 'fill-none stroke-muted-foreground', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
const NODES = [[50, 30], [110, 14], [160, 48], [232, 26], [72, 84], [140, 90], [214, 80]];
const LINKS = [[0, 1], [1, 2], [2, 3], [1, 3], [0, 4], [4, 5], [5, 2], [0, 2], [5, 6], [6, 3], [2, 6]];

function Art({ children }) {
  return (
    <svg viewBox="0 0 280 104" className="h-26 w-full max-w-[280px] overflow-visible">
      {children}
    </svg>
  );
}
function Sparkle({ x, y, s }) {
  return <path className="fill-primary" transform={`translate(${x} ${y}) scale(${s})`} d="M0-8L2-2 8 0 2 2 0 8-2 2-8 0-2-2Z" />;
}
function Coin({ x, r }) {
  return (
    <>
      <circle className="fill-primary" cx={x} cy={52} r={r} />
      <circle className="fill-none stroke-primary-foreground opacity-35" strokeWidth={2} cx={x} cy={52} r={r * 0.8} />
      <text className="fill-primary-foreground font-display font-bold" x={x} y={52 + r * 0.36} textAnchor="middle" fontSize={r}>
        ₿
      </text>
    </>
  );
}
function Block({ x }) {
  return (
    <>
      <rect className="fill-card stroke-foreground" strokeWidth={2} x={x} y={28} width={48} height={48} rx={6} />
      <path {...LINE} d={`M${x + 12} 42h24M${x + 12} 52h18M${x + 12} 62h22`} />
    </>
  );
}
function Chip({ icon: Icon, title, note }) {
  return (
    <div className="grid justify-items-center gap-0.5 rounded-xl border bg-background/40 px-3 py-3 text-center">
      <Icon className="mb-1 size-6 text-primary" />
      <span className="font-display text-sm font-semibold">{title}</span>
      <span className="text-xs text-muted-foreground">{note}</span>
    </div>
  );
}

export const STEPS = [
  {
    title: 'Bitcoin has no boss',
    art: (
      <Art>
        {LINKS.map(([a, b]) => (
          <line key={`${a}-${b}`} {...LINE} x1={NODES[a][0]} y1={NODES[a][1]} x2={NODES[b][0]} y2={NODES[b][1]} />
        ))}
        {NODES.map(([x, y]) => (
          <g key={`${x}-${y}`}>
            <circle className="fill-card stroke-foreground" strokeWidth={2} cx={x} cy={y} r={10} />
            <rect className="fill-primary" x={x - 4} y={y - 4} width={8} height={8} rx={1.5} />
          </g>
        ))}
      </Art>
    ),
    body: (
      <>
        <p>
          Bitcoin is money run by thousands of computers around the world, not a bank. They all keep the same record and check every payment. That&apos;s what{' '}
          <b>decentralized</b> means: no one is in charge, and no one can change the record on their own.
        </p>
        <p className="text-muted-foreground">A one-minute tour. You can skip it, and open it again any time from the miner.</p>
      </>
    ),
  },
  {
    title: 'Your wallet: an address and 12 words',
    art: (
      <div className="grid w-full max-w-sm grid-cols-2 gap-3">
        <Chip icon={MailIcon} title="Address" note="Safe to share" />
        <Chip icon={KeyRoundIcon} title="12 words" note="Keep them secret" />
      </div>
    ),
    body: (
      <>
        <p>
          Your <b>address</b> is like an account number. It&apos;s safe to share: it&apos;s where bitcoin is sent to you.
        </p>
        <p>
          Your <b>12 words</b> are the key. Whoever has them can spend your bitcoin, so keep them secret. They&apos;re made in your browser and never leave it.
        </p>
      </>
    ),
  },
  {
    title: 'Blocks and the guessing game',
    guess: true,
    body: (
      <>
        <p>
          About every 10 minutes, new payments are packed into a <b>block</b>, linked to the one before it. That chain is the <b>blockchain</b>.
        </p>
        <p>
          To add the next block, computers race to find a <b>hash</b> that starts with about 19 zeros. There&apos;s no shortcut, only guessing. Try it:
        </p>
      </>
    ),
  },
  {
    title: 'Why miners get paid',
    art: (
      <Art>
        <Block x={40} />
        <path {...LINE} d="M104 52h52M146 42l10 10-10 10" />
        <Coin x={200} r={34} />
        <Sparkle x={246} y={22} s={0.8} />
        <Sparkle x={160} y={88} s={0.6} />
      </Art>
    ),
    body: (
      <>
        <p>A bank pays its staff to keep its books. Bitcoin has no staff, so it pays its miners instead, for adding each new block.</p>
        <p>The winner gets 3.125 new bitcoin, plus the fees from the payments inside. That&apos;s the only way new bitcoin is made.</p>
      </>
    ),
  },
  {
    title: 'Mining here',
    art: (
      <Art>
        <circle className="fill-primary" cx={80} cy={52} r={40} />
        <circle className="fill-none stroke-primary-foreground opacity-35" strokeWidth={2} cx={80} cy={52} r={32} />
        <path className="fill-primary-foreground" d="M70 34v36l30-18z" />
        {[22, 36, 30, 48, 40, 58, 50].map((h, k) => (
          <rect key={k} className="fill-primary" x={140 + k * 16} y={88 - h} width={10} height={h} rx={2} opacity={0.35 + k * 0.1} />
        ))}
        <path {...LINE} d="M134 88h120" />
      </Art>
    ),
    body: (
      <>
        <p>
          Press <b>Mine BTC</b> to start, and again to stop. You&apos;ll see your speed and your <b>shares</b>: close calls that show real work.
        </p>
        <p>If you find a block, the payout goes to your address about 100 blocks (around 17 hours) later.</p>
        <p className="text-muted-foreground">Mining can warm up your device: the Speed slider turns it down.</p>
      </>
    ),
  },
];

const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const zeros = (n) => `${n} ${n === 1 ? 'zero' : 'zeros'}`;

/** The best of `n` guesses: SHA-256 of a made-up block and a guess, in the browser (Web Crypto). */
async function bestOf(n) {
  const salt = Array.from(crypto.getRandomValues(new Uint32Array(2))).join('');
  const text = new TextEncoder();
  const hashes = await Promise.all(Array.from({ length: n }, (_, i) => crypto.subtle.digest('SHA-256', text.encode(`block ${salt} guess ${i}`))));
  let best = { hash: '', zeros: -1 };
  for (const buf of hashes) {
    const hash = hex(buf);
    const z = hash.match(/^0*/)[0].length;
    if (z > best.zeros) best = { hash, zeros: z };
  }
  return best;
}

/** "Try a few guesses yourself": a handful of hashes, nothing sent anywhere (not mining). */
function GuessGame() {
  const [result, setResult] = useState(null); // { hash, zeros, n }
  const [busy, setBusy] = useState(false);
  const available = typeof crypto !== 'undefined' && Boolean(crypto.subtle);
  const guess = async (n) => {
    setBusy(true);
    try {
      setResult({ ...(await bestOf(n)), n });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2.5" data-testid="guess-game">
      {available && (
        <>
          <code translate="no" data-testid="guess-hash" className="notranslate block rounded-xl border bg-background/40 p-3 font-mono text-[13px] leading-relaxed break-all">
            {result ? (
              <>
                <span className="font-bold text-primary">{result.hash.slice(0, result.zeros)}</span>
                {result.hash.slice(result.zeros)}
              </>
            ) : (
              'Press Guess to try your luck.'
            )}
          </code>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => guess(1)} disabled={busy} data-testid="guess-one">
              Guess
            </Button>
            <Button size="sm" variant="outline" onClick={() => guess(1000)} disabled={busy} data-testid="guess-many">
              Guess 1,000 times
            </Button>
          </div>
          <p aria-live="polite" data-testid="guess-result" className="text-sm font-medium empty:hidden">
            {result && `${result.n === 1 ? 'That guess' : `Best of ${result.n.toLocaleString('en')} guesses`}: ${zeros(result.zeros)}. A winning hash needs about 19.`}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * The tutorial's steps, with Back / Next and Skip. `step` is controlled; `onClose(finished)`
 * when it's skipped or finished; `finishLabel` names where the last button goes. `Title` is
 * the heading element (the dialog passes its DialogTitle).
 */
export default function Tutorial({ step, onStep, onClose, finishLabel, Title = 'h2' }) {
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  // Each step's content comes in (GSAP), unless the visitor prefers less motion.
  const enter = useCallback((el) => {
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.fromTo(el.children, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out', stagger: 0.06, clearProps: 'opacity,transform' });
  }, []);

  return (
    <div data-testid="tutorial" className="flex flex-col gap-5">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <span data-testid="tutorial-count" className="font-mono text-xs text-muted-foreground">
          {step + 1} / {STEPS.length}
        </span>
        {!last && (
          <Button variant="ghost" size="sm" onClick={() => onClose(false)} data-testid="tutorial-skip">
            Skip
          </Button>
        )}
      </div>
      <div aria-live="polite">
        <div key={step} ref={enter} className="flex min-h-[20rem] flex-col gap-3">
          {s.art && (
            <div aria-hidden className="flex justify-center">
              {s.art}
            </div>
          )}
          <Title className="font-display text-xl leading-snug font-semibold tracking-tight sm:text-2xl">{s.title}</Title>
          <div className="space-y-2.5 text-sm leading-relaxed [&_b]:font-semibold">{s.body}</div>
          {s.guess && <GuessGame />}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div aria-hidden className="flex gap-1.5">
          {STEPS.map((_, i) => (
            <span key={i} className={cn('h-1.5 rounded-full transition-all duration-300', i === step ? 'w-5 bg-primary' : 'w-1.5 bg-border')} />
          ))}
        </div>
        <div className="flex gap-2">
          {step > 0 && (
            <Button variant="ghost" onClick={() => onStep(step - 1)} data-testid="tutorial-back">
              Back
            </Button>
          )}
          <Button onClick={() => (last ? onClose(true) : onStep(step + 1))} data-testid="tutorial-next">
            {last ? finishLabel : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  );
}
