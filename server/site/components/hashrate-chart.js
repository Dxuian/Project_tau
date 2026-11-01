'use client';
// The live hashrate graph: one canvas, redrawn only when a sample arrives (every
// 2 s) or the box resizes, with a short GSAP glide between samples. The parent
// unmounts it when the graph is off, so then nothing is drawn at all.
import { gsap } from 'gsap';
import { useEffect, useRef } from 'react';
import { rateText } from '@/lib/format';

const ORANGE = '#f7931a';
const AMBER = '#fbbf24';
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A round number just above `v`, for the y axis. */
function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function draw(canvas, samples, now, windowMs) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(rect.width * dpr);
  const H = Math.round(rect.height * dpr);
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const { width, height } = rect;
  ctx.clearRect(0, 0, width, height);
  const fg = getComputedStyle(canvas).color;
  const pad = { l: 2, r: 70, t: 12, b: 24 };
  const w = Math.max(1, width - pad.l - pad.r);
  const h = Math.max(1, height - pad.t - pad.b);
  const visible = samples.filter((s) => now - s.t <= windowMs + 4000);
  const max = niceMax(Math.max(0, ...visible.map((s) => s.hps)) * 1.15);
  const x = (t) => pad.l + w * (1 - (now - t) / windowMs);
  const y = (v) => pad.t + h * (1 - v / max);

  // Grid lines, rates on the right, minutes along the bottom.
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = fg;
  ctx.strokeStyle = fg;
  ctx.lineWidth = 1;
  ctx.textBaseline = 'middle';
  const empty = visible.length < 2;
  for (let i = 0; i <= 4; i++) {
    const gy = Math.round(pad.t + (h * i) / 4) + 0.5;
    ctx.globalAlpha = i === 4 ? 0.25 : 0.09;
    ctx.setLineDash(i === 4 ? [] : [3, 5]);
    ctx.beginPath();
    ctx.moveTo(pad.l, gy);
    ctx.lineTo(pad.l + w, gy);
    ctx.stroke();
    // No scale until there's something to scale.
    if (empty) continue;
    ctx.globalAlpha = 0.55;
    ctx.fillText(rateText(max * (1 - i / 4)), pad.l + w + 10, gy);
  }
  ctx.setLineDash([]);
  ctx.textBaseline = 'alphabetic';
  ctx.globalAlpha = 0.45;
  const minutes = Math.round(windowMs / 60_000);
  for (let m = minutes; m >= 0; m--) {
    ctx.textAlign = m === 0 ? 'right' : m === minutes ? 'left' : 'center';
    ctx.fillText(m === 0 ? 'now' : `-${m} min`, x(now - m * 60_000), height - 6);
  }
  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;
  if (empty) return;

  // The curve, smoothed between samples, with a glow and a soft fill under it.
  const pts = visible.map((s) => [x(s.t), y(s.hps)]);
  const line = new Path2D();
  line.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    line.bezierCurveTo(cx, y0, cx, y1, x1, y1);
  }
  const area = new Path2D(line);
  area.lineTo(pts[pts.length - 1][0], pad.t + h);
  area.lineTo(pts[0][0], pad.t + h);
  area.closePath();
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.l, 0, w + 1, height);
  ctx.clip();
  const fill = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
  fill.addColorStop(0, 'rgba(247, 147, 26, 0.32)');
  fill.addColorStop(1, 'rgba(247, 147, 26, 0)');
  ctx.fillStyle = fill;
  ctx.fill(area);
  const stroke = ctx.createLinearGradient(pad.l, 0, pad.l + w, 0);
  stroke.addColorStop(0, AMBER);
  stroke.addColorStop(1, ORANGE);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2.25;
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(247, 147, 26, 0.6)';
  ctx.shadowBlur = 14;
  ctx.stroke(line);
  ctx.restore();

  const [lx, ly] = pts[pts.length - 1];
  ctx.fillStyle = ORANGE;
  ctx.globalAlpha = 0.22;
  ctx.beginPath();
  ctx.arc(lx, ly, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(lx, ly, 3.5, 0, Math.PI * 2);
  ctx.fill();
}

export default function HashrateChart({ samples, windowMs = 180_000 }) {
  const canvas = useRef(null);
  const view = useRef({ now: 0 });
  const latest = useRef(samples);
  latest.current = samples;

  useEffect(() => {
    const c = canvas.current;
    const ro = new ResizeObserver(() => draw(c, latest.current, view.current.now || Date.now(), windowMs));
    ro.observe(c);
    return () => ro.disconnect();
  }, [windowMs]);

  useEffect(() => {
    const c = canvas.current;
    const v = view.current;
    const target = samples.length ? samples[samples.length - 1].t : Date.now();
    if (!v.now || !samples.length || reducedMotion()) {
      v.now = target;
      draw(c, samples, v.now, windowMs);
      return undefined;
    }
    const tween = gsap.to(v, { now: target, duration: 0.7, ease: 'power2.out', onUpdate: () => draw(c, latest.current, v.now, windowMs) });
    return () => tween.kill();
  }, [samples, windowMs]);

  return <canvas ref={canvas} role="img" aria-label="Hashrate over the last 3 minutes" className="block h-full w-full text-muted-foreground" />;
}
