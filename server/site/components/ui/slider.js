'use client';
// shadcn/ui Slider (new-york), in plain JS, on Radix.
import * as SliderPrimitive from '@radix-ui/react-slider';
import { cn } from '@/lib/utils';

function Slider({ className, defaultValue, value, min = 0, max = 100, thumbLabel, ...props }) {
  const values = Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min];
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn('relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50', className)}
      {...props}
    >
      <SliderPrimitive.Track data-slot="slider-track" className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
        <SliderPrimitive.Range data-slot="slider-range" className="absolute h-full bg-gradient-to-r from-amber-400 to-primary" />
      </SliderPrimitive.Track>
      {values.map((_, i) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={i}
          aria-label={thumbLabel}
          className="block size-4 shrink-0 cursor-grab rounded-full border border-primary bg-background shadow-sm ring-ring/50 transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden active:cursor-grabbing disabled:pointer-events-none disabled:opacity-50"
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
