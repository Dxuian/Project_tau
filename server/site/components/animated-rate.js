'use client';
// The big hashrate number, tweened by GSAP from the last value to the new one.
// GSAP writes the digits straight into the DOM, so the page doesn't re-render per frame.
import { gsap } from 'gsap';
import { useEffect, useRef } from 'react';
import { rateUnit } from '@/lib/format';

export default function AnimatedRate({ hps, className }) {
  const digits = useRef(null);
  const value = useRef({ v: hps });
  const first = useRef(null);
  const { unit, scale, digits: places } = rateUnit(hps);
  first.current ??= (hps / scale).toFixed(places);

  useEffect(() => {
    const el = digits.current;
    const v = value.current;
    const render = () => {
      if (el) el.textContent = (v.v / scale).toFixed(places);
    };
    const tween = gsap.to(v, { v: hps, duration: 1.1, ease: 'power3.out', onUpdate: render, onComplete: render });
    return () => tween.kill();
  }, [hps, scale, places]);

  return (
    <span className={className}>
      <span ref={digits} data-testid="hashrate" className="tabular-nums">
        {first.current}
      </span>
      <span className="ml-2 align-baseline text-[0.38em] font-medium tracking-normal text-muted-foreground">{unit}</span>
    </span>
  );
}
