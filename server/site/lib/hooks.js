'use client';
// The single screen's state: the miner (consent-first: nothing loads or connects
// until start()), the visitor's payout status, this hour's mining address, and the
// payout address remembered on this device. The events they send are the ones the
// alerts in PostHog count (blocks_seen, mining_unavailable, mining_error).
import { useCallback, useEffect, useRef, useState } from 'react';
import { isValidAddress } from 'tau-crypto/wallet.js';
import { track } from './analytics.js';

/** Samples kept for the graph: 3 minutes at one every 2 s (the miner's hashrate event). */
const SAMPLES = 90;
const SAVED = 'tau.address';

export function useMiner({ address, network, bridgeUrl, pool, minerUrl }) {
  const [state, setState] = useState('idle');
  const [hps, setHps] = useState(0);
  const [samples, setSamples] = useState([]);
  const [shares, setShares] = useState({ accepted: 0, rejected: 0 });
  const [engine, setEngine] = useState(null); // { backend, threads, gpu }
  const [job, setJob] = useState(null); // { height, difficulty }
  const [error, setError] = useState('');
  const [speed, setSpeedValue] = useState(100); // percent of full speed
  const [startedAt, setStartedAt] = useState(0);
  const miner = useRef(null);
  const last = useRef({ hps: 0, accepted: 0, rejected: 0, startedAt: 0 });
  const lastErrorEvent = useRef(0);

  useEffect(() => () => void miner.current?.stop(), []);

  // Miner errors repeat while it reconnects: at most one event a minute.
  const reportError = (message) => {
    if (Date.now() - lastErrorEvent.current < 60_000) return;
    lastErrorEvent.current = Date.now();
    track('mining_error', { error: String(message).slice(0, 200) });
  };

  const start = useCallback(
    async (slot) => {
      if (miner.current || !address) return;
      setError('');
      setState('starting');
      setSamples([]);
      setShares({ accepted: 0, rejected: 0 });
      last.current = { hps: 0, accepted: 0, rejected: 0, startedAt: 0 };
      const throttle = (100 - speed) / 100;
      try {
        const lib = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ minerUrl);
        const url = `${bridgeUrl}${bridgeUrl.includes('?') ? '&' : '?'}slot=${slot}`;
        const m = await lib.mineBTC(address, url, { pool, network, throttle });
        miner.current = m;
        m.on('state', setState);
        m.on('hashrate', (h) => {
          last.current.hps = h.hps;
          setHps(h.hps);
          setSamples((s) => [...s.slice(-(SAMPLES - 1)), { t: Date.now(), hps: h.hps }]);
        });
        m.on('share', (s) => {
          const key = s.accepted ? 'accepted' : 'rejected';
          last.current[key] += 1;
          setShares((c) => ({ ...c, [key]: c[key] + 1 }));
        });
        m.on('job', (j) => setJob({ height: j.height, difficulty: j.difficulty }));
        m.on('error', (e) => {
          setError(e.message);
          reportError(e.message);
        });
        const stats = m.stats();
        setEngine({ backend: stats.backend, threads: stats.threads, gpu: stats.gpu });
        if (stats.height) setJob({ height: stats.height, difficulty: stats.difficulty });
        setState('running');
        last.current.startedAt = Date.now();
        setStartedAt(last.current.startedAt);
        track('mining_started', { throttle });
      } catch (err) {
        setError(err.message);
        setState('idle');
        track('mining_start_failed', { error: String(err.message).slice(0, 200) });
      }
    },
    [address, network, bridgeUrl, pool, minerUrl, speed],
  );

  const stop = useCallback(async () => {
    const m = miner.current;
    miner.current = null;
    await m?.stop();
    const l = last.current;
    track('mining_stopped', {
      seconds: Math.round((Date.now() - l.startedAt) / 1000),
      hashrate: Math.round(l.hps),
      shares_accepted: l.accepted,
      shares_rejected: l.rejected,
    });
    setState('stopped');
    setHps(0);
    setStartedAt(0);
  }, []);

  const setSpeed = useCallback((percent) => {
    setSpeedValue(percent);
    const throttle = (100 - percent) / 100;
    miner.current?.setThrottle(throttle);
    track('mining_speed_changed', { throttle });
  }, []);

  const running = state === 'running' || state === 'starting' || state === 'paused';
  return { state, running, hps, samples, shares, engine, job, error, speed, setSpeed, startedAt, start, stop };
}

/** The visitor's blocks: checked when the address is set, every 5 minutes, and on demand. */
export function usePayouts(address) {
  const [payouts, setPayouts] = useState(null); // null | { results } | { error }
  const [checkedAt, setCheckedAt] = useState(0);
  const [checking, setChecking] = useState(false);
  const blocksSeen = useRef(false);

  const check = useCallback(async () => {
    if (!address) return null;
    setChecking(true);
    let result;
    try {
      const res = await fetch('/api/payout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address }) });
      const body = await res.json().catch(() => ({}));
      result = res.ok ? { results: body.results ?? [] } : { error: body.error ?? `error ${res.status}` };
    } catch {
      result = { error: 'the payout service is unreachable' };
    }
    setPayouts(result);
    setCheckedAt(Date.now());
    setChecking(false);
    if (result.results?.length && !blocksSeen.current) {
      blocksSeen.current = true;
      track('blocks_seen', { count: result.results.length, statuses: [...new Set(result.results.map((r) => r.status))] });
    }
    return result;
  }, [address]);

  useEffect(() => {
    setPayouts(null);
    if (!address) return undefined;
    check();
    const timer = setInterval(check, 5 * 60_000);
    return () => clearInterval(timer);
  }, [address, check]);

  const checkNow = useCallback(async () => {
    const result = await check();
    track('payout_checked', { ok: !result?.error, blocks: result?.results?.length ?? null });
  }, [check]);

  return { payouts, checkedAt, checking, checkNow };
}

/** This hour's mining address of ours (server-rendered), fetched again when the hour turns. */
export function useHour(initial) {
  const [mining, setMining] = useState(initial);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/address', { cache: 'no-store' });
      if (res.ok) setMining(await res.json());
    } catch {
      // keep what we have; the next attempt may work
    }
  }, []);
  useEffect(() => {
    if (!mining) {
      const timer = setInterval(refresh, 30_000);
      return () => clearInterval(timer);
    }
    if (!mining.until) return undefined;
    const timer = setTimeout(refresh, Math.max(1000, Date.parse(mining.until) - Date.now() + 1500));
    return () => clearTimeout(timer);
  }, [mining, refresh]);
  return mining;
}

/** The payout address this device remembers (only the address: never the words). */
export function useSavedAddress(network) {
  const [address, setAddress] = useState(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVED) ?? 'null');
      if (saved?.network === network && isValidAddress(saved.address, network)) {
        setAddress(saved.address);
        track('payout_address_chosen', { source: 'saved' });
      }
    } catch {
      // nothing saved
    }
    setReady(true);
  }, [network]);
  // `source`: how the visitor got it (typed, created, restored).
  const choose = useCallback(
    (next, source) => {
      track('payout_address_chosen', { source });
      try {
        localStorage.setItem(SAVED, JSON.stringify({ address: next, network }));
      } catch {
        // private mode: remembered for this visit only
      }
      setAddress(next);
    },
    [network],
  );
  const forget = useCallback(() => {
    try {
      localStorage.removeItem(SAVED);
    } catch {
      // nothing to forget
    }
    setAddress(null);
  }, []);
  return { address, ready, choose, forget };
}

/** A value from localStorage (a preference), with its setter. */
export function usePreference(key, initial) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) setValue(JSON.parse(saved));
    } catch {
      // the default, then
    }
  }, [key]);
  const set = useCallback(
    (next) => {
      setValue(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // not remembered
      }
    },
    [key],
  );
  return [value, set];
}

/** Re-renders the caller every `ms` while `on` (for clocks), and nothing else. */
export function useTick(on, ms = 1000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!on) return undefined;
    const timer = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(timer);
  }, [on, ms]);
}
