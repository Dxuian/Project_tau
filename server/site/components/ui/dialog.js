'use client';
// shadcn/ui Dialog (new-york), in plain JS, on Radix (focus trap, Escape, aria).
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

function Dialog(props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}
function DialogTrigger(props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}
function DialogClose(props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}
function DialogOverlay({ className, ...props }) {
  return <DialogPrimitive.Overlay data-slot="dialog-overlay" className={cn('dialog-overlay fixed inset-0 z-50 bg-black/60 backdrop-blur-sm', className)} {...props} />;
}
function DialogContent({ className, children, showClose = true, ...props }) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'dialog-content fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-2xl border bg-popover p-6 text-popover-foreground shadow-2xl sm:max-w-lg',
          className,
        )}
        {...props}
      >
        {children}
        {showClose && (
          <DialogPrimitive.Close className="absolute top-4 right-4 rounded-md p-1 opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden [&_svg]:size-4">
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
function DialogHeader({ className, ...props }) {
  return <div data-slot="dialog-header" className={cn('flex flex-col gap-1.5 pr-6 text-left', className)} {...props} />;
}
function DialogFooter({ className, ...props }) {
  return <div data-slot="dialog-footer" className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />;
}
function DialogTitle({ className, ...props }) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn('text-lg leading-none font-semibold', className)} {...props} />;
}
function DialogDescription({ className, ...props }) {
  return <DialogPrimitive.Description data-slot="dialog-description" className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export { Dialog, DialogTrigger, DialogClose, DialogOverlay, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription };
