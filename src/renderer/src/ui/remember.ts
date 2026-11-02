import { trpcClient } from '../trpc';

/**
 * Keeps one of the window's remembered preferences in its local storage (null
 * removes it) and has the main process put it on disk soon. Chromium writes
 * local storage on its own schedule, and an app ended with the desktop session
 * may not get to it (spec §5). Without local storage (a private profile) the
 * preference lasts for this run only.
 */
export function remember(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    return;
  }
  trpcClient.ui.remembered.mutate().catch(() => {
    // written on Chromium's own schedule then
  });
}
