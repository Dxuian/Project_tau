'use client';
// Project Tau on one screen. First, until the visitor has a payout address: the
// wallet setup (components/wallet-setup.js). Then the miner. Left: the rig (the
// mine button, the hashrate, the stats, the speed) and the live graph. Right: the
// details (the payout address, this hour's mining address, the visitor's blocks).
// Nothing loads or mines until the visitor presses the mine button.
import { gsap } from 'gsap';
import { ActivityIcon, CpuIcon, GaugeIcon, GlobeIcon, ShieldCheckIcon, TimerIcon, ZapIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import AnimatedRate from '@/components/animated-rate';
import BlocksCard from '@/components/blocks-card';
import { celebrate } from '@/components/celebrate';
import HashrateChart from '@/components/hashrate-chart';
import PayoutCard from '@/components/payout-card';
import ThemePicker from '@/components/theme-picker';
import WalletSetup from '@/components/wallet-setup';
import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { track } from '@/lib/analytics';
import { countdown, duration } from '@/lib/format';
import { useHour, useMiner, usePayouts, usePreference, useSavedAddress, useTick } from '@/lib/hooks';
import { cn } from '@/lib/utils';

const SPEEDS = { 25: 'Quarter', 50: 'Half', 75: '75%', 100: 'Full' };
const STATES = {
  idle: ['Idle', 'bg-muted-foreground'],
  starting: ['Starting', 'bg-primary live-dot'],
  running: ['Mining', 'bg-success live-dot'],
  paused: ['Paused', 'bg-primary'],
  stopped: ['Stopped', 'bg-muted-foreground'],
};
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const reveal = (i) => ({ style: { '--i': i } });

export default function Dashboard({ network, bridgeUrl, pool, minerUrl, initialMining }) {
  const saved = useSavedAddress(network);
  const mining = useHour(initialMining);
  const miner = useMiner({ address: saved.address, network, bridgeUrl, pool, minerUrl });
  const blocks = usePayouts(saved.address);
  const [live, setLive] = usePreference('tau.graph', true);
  const [changing, setChanging] = useState(false);
  const rig = useRef(null);
  const view = !saved.ready ? 'loading' : !saved.address || changing ? 'setup' : 'miner';

  // A small jolt when mining starts.
  useEffect(() => {
    if (miner.state !== 'running' || !rig.current || reducedMotion()) return;
    gsap.fromTo(rig.current, { scale: 0.985 }, { scale: 1, duration: 0.9, ease: 'elastic.out(1, 0.45)', clearProps: 'scale' });
  }, [miner.state]);

  // Confetti when a block shows up after the first check.
  const count = blocks.payouts?.results?.length;
  const seen = useRef(null);
  useEffect(() => {
    if (count === undefined) return;
    if (seen.current !== null && count > seen.current) celebrate();
    seen.current = count;
  }, [count]);

  const blocker = !saved.address ? 'Add a payout address first.' : !mining ? 'Mining is unavailable right now.' : null;
  const [stateLabel, dot] = view !== 'miner' ? ['Setup', 'bg-primary'] : mining ? STATES[miner.state] ?? STATES.idle : ['Unavailable', 'bg-destructive'];
  const toggle = () => (miner.running ? miner.stop() : miner.start(mining?.index));

  return (
    <div className={cn('relative isolate min-h-dvh', view === 'miner' && 'lg:h-dvh lg:overflow-hidden')}>
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="theme-pattern absolute inset-0" />
        <div className="backdrop-grid absolute inset-0" />
        <div className="glow glow-a -top-48 -left-40 size-[40rem]" />
        <div className="glow glow-b top-1/3 -right-48 size-[36rem]" />
      </div>

      <div className={cn('mx-auto flex h-full max-w-[1480px] flex-col gap-4 p-4 sm:p-5 lg:p-6', view !== 'miner' && 'min-h-dvh')}>
        <header {...reveal(0)} className="reveal flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary font-display text-xl font-black text-primary-foreground shadow-[0_0_32px_-6px] shadow-primary/70">
              τ
            </div>
            <div className="min-w-0 leading-tight">
              <h1 className="truncate font-display text-base font-semibold tracking-tight">Project Tau</h1>
              <p className="truncate text-xs text-muted-foreground">Mine Bitcoin in your browser.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="hidden capitalize md:inline-flex">
              <GlobeIcon />
              {network}
            </Badge>
            <span data-testid="state" className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium backdrop-blur">
              <span className={cn('size-2 rounded-full', dot)} />
              {stateLabel}
            </span>
            <ThemePicker />
          </div>
        </header>

        {view === 'loading' && <div aria-hidden className="mx-auto mt-10 h-64 w-full max-w-5xl animate-pulse rounded-2xl border bg-card" />}
        {view === 'setup' && (
          <div className="flex flex-1 items-start justify-center py-4 sm:py-8 lg:items-center lg:pb-24">
            <WalletSetup
              network={network}
              onDone={(address, source) => {
                saved.choose(address, source);
                setChanging(false);
              }}
              onCancel={saved.address ? () => setChanging(false) : null}
            />
          </div>
        )}
        {view === 'miner' && (
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
          {/* Below lg, main and aside dissolve (display: contents) so the cards stack in the order a visitor uses them. */}
          <main className="contents lg:flex lg:min-h-0 lg:flex-col lg:gap-4">
            <Card ref={rig} {...reveal(1)} data-testid="rig" className="reveal relative order-1 overflow-visible lg:order-none">
              <div aria-hidden className="marquee" />
              {miner.running && <div aria-hidden className="mining-ring" />}
              <CardContent className="flex flex-col items-center gap-6 py-2 sm:flex-row sm:items-center sm:gap-8">
                <div className="flex flex-col items-center gap-3">
                  <button
                    type="button"
                    className="mine-btn"
                    data-running={miner.running || undefined}
                    data-testid={miner.running ? 'stop' : 'start'}
                    aria-pressed={miner.running}
                    aria-label={miner.running ? 'Stop mining' : 'Start mining'}
                    disabled={miner.state === 'starting' || (!miner.running && Boolean(blocker))}
                    onClick={toggle}
                  >
                    <span className="mine-label">Mine BTC</span>
                    <span className="mine-label mine-btc">₿</span>
                    <span className="mine-sub">{miner.state === 'starting' ? 'Starting…' : miner.running ? 'Stop' : 'Start'}</span>
                  </button>
                  <p className="min-h-4 max-w-[12rem] text-center text-xs text-muted-foreground">
                    {miner.error ? (
                      <span className="text-destructive">{miner.error}</span>
                    ) : miner.state === 'paused' ? (
                      'Paused while this tab is hidden.'
                    ) : blocker && !miner.running ? (
                      <button className="underline underline-offset-2 hover:text-foreground lg:no-underline" onClick={() => document.getElementById('payout')?.scrollIntoView({ behavior: 'smooth' })}>
                        {blocker}
                      </button>
                    ) : null}
                  </p>
                </div>

                <div className="flex w-full min-w-0 flex-1 flex-col gap-5">
                  <div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <GaugeIcon className="size-4" />
                      Your hashrate
                    </div>
                    <AnimatedRate hps={miner.hps} className="mt-1 block font-num text-5xl font-semibold tracking-tight sm:text-6xl" />
                  </div>
                  <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
                    <Stat label="Shares" value={miner.shares.accepted} hint={miner.shares.rejected ? `${miner.shares.rejected} rejected` : 'accepted'} />
                    <Stat label="Uptime" value={<Uptime since={miner.startedAt} />} hint={miner.state === 'paused' ? 'paused' : 'this session'} />
                    <Stat label="Threads" value={miner.engine?.threads ?? '–'} hint={miner.engine?.backend ?? 'picked at start'} />
                    <Stat label="Block" value={miner.job?.height ? `#${miner.job.height.toLocaleString('en')}` : '–'} hint="being mined" />
                  </dl>
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
              </CardContent>
            </Card>

            <Card {...reveal(2)} className="reveal order-3 min-h-[300px] flex-1 lg:order-none lg:min-h-0">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ActivityIcon className="size-4 text-primary" />
                  Live hashrate
                  {miner.state === 'running' && <span className="live-dot size-1.5 rounded-full bg-success" />}
                </CardTitle>
                <CardDescription>The last 3 minutes.</CardDescription>
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
                        {miner.running ? 'Warming up…' : 'Press Mine BTC, and your hashrate draws itself here.'}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="grid h-full place-items-center rounded-xl border border-dashed text-center text-sm text-muted-foreground">
                    <div className="space-y-2 p-6">
                      <ZapIcon className="mx-auto size-5 text-primary" />
                      <p>Graph off: its CPU goes to mining.</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </main>

          <aside className="contents lg:flex lg:min-h-0 lg:flex-col lg:gap-4 lg:overflow-y-auto lg:pr-1 lg:[scrollbar-width:thin]">
            <PayoutCard
              {...reveal(3)}
              className="reveal order-2 gap-3 py-4 lg:order-none"
              network={network}
              address={saved.address}
              locked={miner.running}
              onChange={() => setChanging(true)}
            />

            <Card {...reveal(4)} className="reveal order-4 gap-3 py-4 lg:order-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TimerIcon className="size-4 text-primary" />
                  This hour&apos;s mining address
                </CardTitle>
                <CardDescription>Shared by everyone mining this hour.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {mining ? (
                  <>
                    <code data-testid="mining-address" translate="no" className="notranslate block rounded-xl border bg-background/40 p-3 font-mono text-[13px] leading-relaxed break-all">
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
                  <p className="text-sm text-destructive">The payout service can&apos;t be reached right now. This retries every 30 seconds.</p>
                )}
              </CardContent>
            </Card>

            <BlocksCard
              {...reveal(5)}
              className="reveal order-5 gap-3 py-4 lg:order-none"
              network={network}
              address={saved.address}
              payouts={blocks.payouts}
              checkedAt={blocks.checkedAt}
              checking={blocks.checking}
              onCheck={blocks.checkNow}
            />

            <p {...reveal(6)} className="reveal order-6 flex gap-2 px-1 pb-2 text-xs leading-relaxed text-muted-foreground lg:order-none">
              <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0 text-success" />
              <span>Your 12 words never leave this device. We don&apos;t monitor any sensitive data.</span>
            </p>
          </aside>
        </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-num text-xl font-medium tabular-nums">{value}</dd>
      {hint && <dd className="truncate text-[11px] text-muted-foreground">{hint}</dd>}
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
