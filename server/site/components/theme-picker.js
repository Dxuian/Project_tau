'use client';
// The theme button: a grid of every theme, each tile drawn in its own theme
// (data-theme on the tile). The choice applies at once and stays on this device.
import { CheckIcon, PaletteIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { track } from '@/lib/analytics';
import { applyTheme, DEFAULT_THEME, THEMES } from '@/lib/themes';
import { cn } from '@/lib/utils';

export default function ThemePicker() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState(DEFAULT_THEME);
  useEffect(() => setTheme(document.documentElement.getAttribute('data-theme') || DEFAULT_THEME), []);
  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0];
  const choose = (id) => {
    setTheme(applyTheme(id).id);
    track('theme_changed', { theme: id });
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} aria-label="Choose a theme" data-testid="theme-button">
        <PaletteIcon />
        <span className="hidden sm:inline">{current.name}</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="font-display">Themes</DialogTitle>
            <DialogDescription>Remembered on this device.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                data-theme={t.id}
                data-testid={`theme-${t.id}`}
                aria-pressed={t.id === theme}
                onClick={() => choose(t.id)}
                className={cn(
                  'group relative h-24 overflow-hidden rounded-xl border bg-background text-left text-foreground transition-transform hover:-translate-y-0.5 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                  t.id === theme && 'ring-2 ring-primary',
                )}
              >
                <span aria-hidden className="theme-pattern absolute inset-0" />
                <span className="relative flex h-full flex-col justify-between p-3">
                  <span className="flex items-center gap-2" aria-hidden>
                    <span className="size-5 rounded-full border bg-primary" />
                    <span className="h-3 flex-1 rounded-sm border bg-card" />
                  </span>
                  <span className="truncate font-display text-sm">{t.name}</span>
                </span>
                {t.id === theme && <CheckIcon className="absolute top-2 right-2 size-4 text-primary" />}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
