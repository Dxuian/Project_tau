'use client';
// Project Tau on one screen. Left: the miner (the hashrate, the live graph, the
// controls). Right: the details (the payout address, this hour's mining address,
// the visitor's blocks, the odds). Consent-first: nothing loads or mines until the
// visitor agrees and presses Start.
import { gsap } from 'gsap';
import { ActivityIcon, CpuIcon, GaugeIcon, GlobeIcon, PlayIcon, ShieldCheckIcon, SquareIcon, TimerIcon, ZapIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import AnimatedRate from '@/components/animated-rate';
import BlocksCard from '@/components/blocks-card';
import { celebrate } from '@/components/celebrate';
import HashrateChart from '@/components/hashrate-chart';
import PayoutCard from '@/components/payout-card';
import ThemeToggle from '@/components/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { track } from '@/lib/analytics';
import { countdown, duration, oddsText } from '@/lib/format';
import { useHour, useMiner, usePayouts, usePreference, useSavedAddress, useTick } from '@/lib/hooks';
import { cn } from '@/lib/utils';

const SPEEDS = { 25: 'Quarter', 50: 'Half', 75: '75%', 100: 'Full' };
const STATES = {
  idle: ['Idle', 'bg-muted-foreground'],
  starting: ['Starting', 'bg-primary live-dot'],
  running: ['Mining', 'bg-success live-dot'],
  paused: ['Paused', 'bg-amber-400'],
  stopped: ['Stopped', 'bg-muted-foreground'],
};
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const reveal = (i) => ({ className: 'reveal', style: { '--i': i } });

export default function Dashboard({ network, bridgeUrl, pool, minerUrl, initialMining, analytics }) {
  const saved = useSavedAddress(network);
  const mining = useHour(initialMining);
  const miner = useMiner({ address: saved.address, network, bridgeUrl, pool, minerUrl });
  const blocks = usePayouts(saved.address);
  const [consent, setConsent] = useState(false);
  const [live, setLive] = usePreference('tau.graph', true);
  const hero = useRef(null);

  // A small jolt when mining starts.
  useEffect(() => {
    if (miner.state !== 'running' || !hero.current || reducedMotion()) return;
    gsap.fromTo(hero.current, { scale: 0.985 }, { scale: 1, duration: 0.9, ease: 'elastic.out(1, 0.45)', clearProps: 'scale' });
  }, [miner.state]);

  // Confetti when a block shows up after the first check.
  const count = blocks.payouts?.results?.length;
  const seen = useRef(null);
  useEffect(() => {
    if (count === undefined) return;
    if (seen.current !== null && count > seen.current) celebrate();
    seen.current = count;
  }, [count]);

  const blocker = !saved.address ? 'Add a payout address first.' : !mining ? 'Mining is unavailable right now.' : !consent ? 'Tick the agreement to start.' : null;
  const [stateLabel, dot] = mining ? STATES[miner.state] ?? STATES.idle : ['Unavailable', 'bg-destructive'];

  return (
    <div className="relative isolate min-h-dvh lg:h-dvh lg:overflow-hidden">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="backdrop-grid absolute inset-0" />
        <div className="glow glow-a -top-48 -left-40 size-[40rem]" />
        <div className="glow glow-b top-1/3 -right-48 size-[36rem]" />
      </div>

      <div className="mx-auto flex h-full max-w-[1480px] flex-col gap-4 p-4 sm:p-5 lg:p-6">
        <header {...reveal(0)} className="reveal flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-amber-200 via-amber-400 to-orange-600 text-xl font-black text-black shadow-[0_0_32px_-6px] shadow-primary/70">
              τ
            </div>
            <div className="leading-tight">
              <h1 className="text-base font-semibold tracking-tight">Project Tau</h1>
              <p className="text-xs text-muted-foreground">Mine Bitcoin in your browser. Find a block, get 10%.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="hidden capitalize sm:inline-flex">
              <GlobeIcon />
              {network}
            </Badge>
            <span data-testid="state" className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium backdrop-blur">
              <span className={cn('size-2 rounded-full', dot)} />
              {stateLabel}
            </span>
            <ThemeToggle />
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
          {/* Below lg, main and aside dissolve (display: contents) so the cards stack in the order a visitor uses them. */}
          <main className="contents lg:flex lg:min-h-0 lg:flex-col lg:gap-4">
            <Card ref={hero} {...reveal(1)} className="reveal relative order-1 overflow-visible lg:order-none">
              {miner.running && <div aria-hidden className="mining-ring" />}
              <CardContent className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <GaugeIcon className="size-4" />
                    Your hashrate
                  </div>
                  <AnimatedRate hps={miner.hps} className="mt-2 block font-mono text-5xl font-semibold tracking-tight sm:text-6xl" />
                  <p className="mt-3 max-w-md text-xs text-muted-foreground">
                    {oddsText(miner.hps) ? (
                      <>
                        At this speed, about one block every <span className="font-mono text-foreground">{oddsText(miner.hps)}</span>: a lottery ticket, not income.
                      </>
                    ) : (
                      'A lottery ticket, not income: the whole network does about 10²¹ hashes a second.'
                    )}
                  </p>
                </div>
                <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
                  <Stat label="Shares" value={miner.shares.accepted} hint={miner.shares.rejected ? `${miner.shares.rejected} rejected` : 'accepted'} />
                  <Stat label="Uptime" value={<Uptime since={miner.startedAt} />} hint={miner.state === 'paused' ? 'paused' : 'this session'} />
                  <Stat label="Threads" value={miner.engine?.threads ?? '–'} hint={miner.engine?.backend ?? 'picked at start'} />
                  <Stat label="Block" value={miner.job?.height ? `#${miner.job.height.toLocaleString('en')}` : '–'} hint="being mined" />
                </dl>
              </CardContent>
            </Card>

            <Card {...reveal(2)} className="reveal order-4 min-h-[300px] flex-1 lg:order-none lg:min-h-0">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ActivityIcon className="size-4 text-primary" />
                  Live hashrate
                  {miner.state === 'running' && <span className="live-dot size-1.5 rounded-full bg-success" />}
                </CardTitle>
                <CardDescription>The last 3 minutes, a point every 2 seconds.</CardDescription>
                <CardAction>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                    Graph
                    <Switch
                      checked={live}
                      onCheckedChange={(on) => {
                        setLive(on);
                        track('live_graph_toggled', { on });
                      }}
                      aria-label="Live graph"
                      data-testid="live-graph"
                    />
                  </label>
                </CardAction>
              </CardHeader>
              <CardContent className="relative min-h-[200px] flex-1">
                {live ? (
                  <>
                    <HashrateChart samples={miner.samples} />
                    {miner.samples.length < 2 && (
                      <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted-foreground">
                        {miner.running ? 'Warming up…' : 'Press Start, and your hashrate draws itself here.'}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="grid h-full place-items-center rounded-xl border border-dashed text-center text-sm text-muted-foreground">
                    <div className="space-y-2 p-6">
                      <ZapIcon className="mx-auto size-5 text-primary" />
                      <p>The graph is off, so the CPU it used goes to mining.</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card {...reveal(3)} className="reveal order-3 lg:order-none">
              <CardContent className="grid gap-5 md:grid-cols-[minmax(0,1fr)_15rem] md:items-center">
                <div className="space-y-5">
                  <label className="flex cursor-pointer items-start gap-3">
                    <Switch
                      checked={consent}
                      disabled={miner.running}
                      onCheckedChange={(on) => {
                        setConsent(on);
                        if (on) track('mining_consent_given');
                      }}
                      aria-label="I agree to mine with this device"
                      data-testid="consent"
                      className="mt-0.5"
                    />
                    <span className="text-sm leading-snug">
                      I agree to mine with this device. It uses the CPU (and power) while this page is open, and pauses when I switch away.
                    </span>
                  </label>
                  <div className="flex items-center gap-4">
                    <span className="flex w-16 items-center gap-1.5 text-xs text-muted-foreground">
                      <CpuIcon className="size-3.5" />
                      Speed
                    </span>
                    <Slider
                      value={[miner.speed]}
                      min={25}
                      max={100}
                      step={25}
                      onValueChange={([v]) => v !== miner.speed && miner.setSpeed(v)}
                      thumbLabel="Mining speed"
                      data-testid="speed"
                      className="max-w-xs"
                    />
                    <span className="w-16 font-mono text-xs">{SPEEDS[miner.speed]}</span>
                  </div>
                </div>
                <div className="space-y-2">
                  {miner.running ? (
                    <Button size="lg" variant="secondary" className="w-full" onClick={miner.stop} data-testid="stop">
                      <SquareIcon className="fill-current" />
                      Stop
                    </Button>
                  ) : (
                    <Button
                      size="lg"
                      className="w-full bg-gradient-to-r from-amber-300 to-primary text-black shadow-[0_10px_34px_-10px] shadow-primary/70 hover:brightness-110"
                      onClick={() => miner.start(mining?.index)}
                      disabled={Boolean(blocker)}
                      data-testid="start"
                    >
                      <PlayIcon className="fill-current" />
                      Start mining
                    </Button>
                  )}
                  <p className="min-h-4 text-center text-xs text-muted-foreground">
                    {miner.error ? (
                      <span className="text-destructive">{miner.error}</span>
                    ) : miner.running ? (
                      miner.state === 'paused' ? (
                        'Paused while this tab is hidden.'
                      ) : (
                        'Mining. Stop any time.'
                      )
                    ) : blocker === 'Add a payout address first.' ? (
                      <button className="underline underline-offset-2 hover:text-foreground lg:no-underline" onClick={() => document.getElementById('payout')?.scrollIntoView({ behavior: 'smooth' })}>
                        {blocker}
                      </button>
                    ) : (
                      (blocker ?? 'Ready when you are.')
                    )}
                  </p>
                </div>
              </CardContent>
            </Card>
          </main>

          <aside className="contents lg:flex lg:min-h-0 lg:flex-col lg:gap-4 lg:overflow-y-auto lg:pr-1 lg:[scrollbar-width:thin]">
            <PayoutCard
              {...reveal(4)}
              className="reveal order-2 gap-3 py-4 lg:order-none"
              network={network}
              address={saved.address}
              ready={saved.ready}
              locked={miner.running}
              onChoose={saved.choose}
            />

            <Card {...reveal(5)} className="reveal order-5 gap-3 py-4 lg:order-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TimerIcon className="size-4 text-primary" />
                  This hour&apos;s mining address
                </CardTitle>
                <CardDescription>Ours, shared by everyone mining this hour.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {mining ? (
                  <>
                    <code data-testid="mining-address" translate="no" className="notranslate block break-all rounded-xl border bg-background/40 p-3 font-mono text-[13px] leading-relaxed">
                      {mining.address}
                    </code>
                    <div className="grid grid-cols-2 gap-2">
                      <Fact label="Slot" value={`#${mining.index}`} />
                      <Fact label="Next address in" value={<Countdown until={mining.until} />} />
                      <Fact label="Pool" value={pool.replace(/^stratum\+\w+:\/\//, '')} />
                      <Fact label="Engine" value={miner.engine ? `${miner.engine.backend} × ${miner.engine.threads}` : 'picked at start'} />
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-destructive">The payout service can&apos;t be reached, so mining is off for now. This retries every 30 seconds.</p>
                )}
              </CardContent>
            </Card>

            <BlocksCard
              {...reveal(6)}
              className="reveal order-6 gap-3 py-4 lg:order-none"
              network={network}
              address={saved.address}
              payouts={blocks.payouts}
              checkedAt={blocks.checkedAt}
              checking={blocks.checking}
              onCheck={blocks.checkNow}
            />

            <p {...reveal(7)} className="reveal order-7 flex gap-2 px-1 pb-2 text-xs leading-relaxed text-muted-foreground lg:order-none">
              <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0 text-success" />
              <span>
                Nothing mines until you press Start. Your 12 words never leave this device.
                {analytics && ' We count visits and button presses with PostHog, never your words or your address.'}
              </span>
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-xl font-medium tabular-nums">{value}</dd>
      {hint && <dd className="text-[11px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}

function Fact({ label, value }) {
  return (
    <div className="rounded-xl border bg-background/40 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="truncate font-mono text-xs">{value}</div>
    </div>
  );
}

/** Mounted-only clocks: no server/client mismatch, and only they re-render each second. */
function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

function Uptime({ since }) {
  const mounted = useMounted();
  useTick(Boolean(since));
  return mounted && since ? duration(Date.now() - since) : '–';
}

function Countdown({ until }) {
  const mounted = useMounted();
  useTick(Boolean(until));
  return mounted && until ? countdown(Date.parse(until) - Date.now()) : '--:--';
}
