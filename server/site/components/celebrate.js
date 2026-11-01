// A burst of confetti (GSAP) for a block found by the visitor's miner. Skipped for reduced motion.
import { gsap } from 'gsap';

const COLORS = ['#f7931a', '#fbbf24', '#fde68a', '#a78bfa', '#f472b6', '#34d399'];

export function celebrate() {
  if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:60';
  document.body.append(layer);
  for (let i = 0; i < 90; i++) {
    const bit = document.createElement('i');
    const size = 5 + Math.random() * 7;
    bit.style.cssText = `position:absolute;left:50%;top:38%;width:${size}px;height:${size * (1 + Math.random())}px;border-radius:2px;background:${COLORS[i % COLORS.length]}`;
    layer.append(bit);
    const angle = Math.random() * Math.PI * 2;
    const reach = 140 + Math.random() * 420;
    gsap.to(bit, {
      x: Math.cos(angle) * reach,
      y: Math.sin(angle) * reach + 260,
      rotation: Math.random() * 900 - 450,
      opacity: 0,
      duration: 1.4 + Math.random() * 1.2,
      ease: 'power3.out',
    });
  }
  gsap.delayedCall(3, () => layer.remove());
}
