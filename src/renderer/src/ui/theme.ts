import { useQuery } from '@tanstack/react-query';
import { useSubscription } from '@trpc/tanstack-react-query';
import { useEffect, useState } from 'react';
import { useTRPC } from '../trpc';

export type Theme = 'light' | 'dark';

const root = document.documentElement;

export function currentTheme(): Theme {
  return root.dataset.theme === 'dark' ? 'dark' : 'light';
}

/**
 * Keeps <html data-theme> on the OS appearance (nativeTheme in the main
 * process). main.tsx sets a first value from the media query before the first
 * paint; Electron's media query follows nativeTheme too.
 */
export function useNativeTheme(): Theme {
  const trpc = useTRPC();
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const initial = useQuery(trpc.app.theme.queryOptions());
  useSubscription(
    trpc.app.themeChanges.subscriptionOptions(undefined, {
      onData: ({ dark }) => setTheme(dark ? 'dark' : 'light'),
    }),
  );
  useEffect(() => {
    if (initial.data) setTheme(initial.data.dark ? 'dark' : 'light');
  }, [initial.data]);
  useEffect(() => {
    root.dataset.theme = theme;
  }, [theme]);
  return theme;
}

/** Resolves a theme token (e.g. `--color-term`) to an rgb()/rgba() string xterm can parse. */
export function tokenColor(name: string): string {
  const value = getComputedStyle(root).getPropertyValue(name).trim();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || !value) return value;
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data as unknown as number[];
  return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a ?? 0) / 255})`;
}
