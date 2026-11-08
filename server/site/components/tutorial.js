'use client';
// The visitor's tutorial: how Bitcoin mining works, for someone new to it, in four
// one-sentence steps. It opens as an overlay (app/dashboard.js): by itself on a first
// visit (until it's closed once: useTutorial), and again from "See tutorial" on the
// miner. Its pictures use the theme's tokens.
import { gsap } from 'gsap';
import { KeyRoundIcon, MailIcon } from 'lucide-react';
import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const LINE = { className: 'fill-none stroke-muted-foreground', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
const TEXT = 'space-y-2.5 text-sm leading-relaxed [&_b]:font-semibold';

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

// A winning hash, for scale: it starts with about 19 zeros (a picture, not a real block).
const WINNING = `${'0'.repeat(19)}3a7f19c4e2b80d56f1a9c37e4b2d08f65c1e9a43b7d20`;
function WinningHash() {
  return (
    <code translate="no" className="block w-full max-w-sm rounded-xl border bg-background/40 p-3 font-mono text-[13px] leading-relaxed break-all text-muted-foreground">
      <span className="font-bold text-primary">{WINNING.slice(0, 19)}</span>
      {WINNING.slice(19)}
    </code>
  );
}

// One sentence each.
export const STEPS = [
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
      <p>
        Bitcoin is like a bank, but instead of paying employees, it pays its <b>miners</b>.
      </p>
    ),
  },
  {
    title: 'Mining is guessing',
    art: <WinningHash />,
    body: <p>To win new bitcoin, a miner has to guess a number that starts with about 19 zeros.</p>,
  },
  {
    title: 'Your wallet',
    art: (
      <div className="grid w-full max-w-sm grid-cols-2 gap-3">
        <Chip icon={MailIcon} title="Address" note="Safe to share" />
        <Chip icon={KeyRoundIcon} title="12 words" note="Your password" />
      </div>
    ),
    body: (
      <p>
        Your <b>address</b> is safe to share, but your <b>12 words</b> are your wallet&apos;s password: never share or lose them.
      </p>
    ),
  },
  {
    title: 'Your turn',
    art: (
      <Art>
        <Coin x={64} r={30} />
        <path className="fill-none stroke-primary" strokeWidth={2} strokeDasharray="5 4" d="M106 52h62" />
        <path {...LINE} d="M164 42l10 10-10 10" />
        <rect className="fill-card stroke-foreground" strokeWidth={2} x={190} y={30} width={64} height={44} rx={6} />
        <path {...LINE} d="M190 36l32 20 32-20" />
        <Sparkle x={26} y={20} s={0.6} />
      </Art>
    ),
    body: (
      <p>
        Press <b>Mine BTC</b> to start guessing, and if you ever win, the bitcoin goes to your address.
      </p>
    ),
  },
];

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
        <div key={step} ref={enter} className="flex min-h-[13rem] flex-col gap-3">
          {s.art && (
            <div aria-hidden className="flex justify-center">
              {s.art}
            </div>
          )}
          <Title className="font-display text-xl leading-snug font-semibold tracking-tight sm:text-2xl">{s.title}</Title>
          <div className={TEXT}>{s.body}</div>
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
