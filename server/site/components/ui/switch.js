'use client';
// shadcn/ui Switch (new-york), in plain JS, on Radix.
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/lib/utils';

function Switch({ className, ...props }) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input dark:data-[state=unchecked]:bg-input/80',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full bg-background ring-0 shadow transition-transform data-[state=checked]:translate-x-[calc(100%-1px)] data-[state=unchecked]:translate-x-0.5 dark:data-[state=checked]:bg-primary-foreground dark:data-[state=unchecked]:bg-foreground"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
