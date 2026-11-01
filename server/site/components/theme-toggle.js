'use client';
// Dark by default (<html class="dark">); a visitor who picks light keeps it on this device.
import { MoonIcon, SunIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

const KEY = 'tau.theme';

export default function ThemeToggle() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) === 'light') {
        document.documentElement.classList.remove('dark');
        setDark(false);
      }
    } catch {
      // stays dark
    }
  }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem(KEY, next ? 'dark' : 'light');
    } catch {
      // not remembered
    }
  };
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'}>
      {dark ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}
