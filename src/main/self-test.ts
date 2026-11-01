import { BRAND } from '@shared/brand';
import { app, type BrowserWindow } from 'electron';

const TIMEOUT_MS = 30_000;

export const isSelfTest = process.argv.includes('--self-test');

/**
 * Headless launch check used by scripts/linux-check.sh: waits for the UI to
 * render, fails on any renderer console error (CSP violations included), runs
 * `check` for main-process services, and exits with 0 on success.
 */
export function runSelfTest(win: BrowserWindow, check: () => Promise<string | null>): void {
  const errors: string[] = [];
  const finish = (ok: boolean, detail: string) => {
    const out = ok ? process.stdout : process.stderr;
    out.write(`self-test ${ok ? 'passed' : 'failed'}: ${detail}\n`);
    app.exit(ok ? 0 : 1);
  };

  const timer = setTimeout(() => finish(false, 'timed out waiting for the UI'), TIMEOUT_MS);

  win.webContents.on('console-message', ({ level, message }) => {
    if (level === 'error') errors.push(message);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    finish(false, `renderer gone: ${details.reason}`);
  });
  win.webContents.on('did-finish-load', async () => {
    try {
      const ready: boolean = await win.webContents.executeJavaScript(
        `new Promise((resolve) => {
          const check = () => document.querySelector('[data-app-ready]') ? resolve(true) : setTimeout(check, 100);
          check();
        })`,
      );
      // Give late errors (failed loads, CSP reports) a moment to arrive.
      await new Promise((r) => setTimeout(r, 500));
      clearTimeout(timer);
      if (!ready) return finish(false, 'UI did not render');
      // `<Profile> — <Name>` (spec §5), or the bare name before a profile is shown.
      const title = win.getTitle();
      if (title !== BRAND.displayName && !title.endsWith(` — ${BRAND.displayName}`)) {
        return finish(false, `unexpected window title "${win.getTitle()}"`);
      }
      if (errors.length > 0) return finish(false, `console errors:\n  ${errors.join('\n  ')}`);
      const problem = await check();
      if (problem) return finish(false, problem);
      finish(true, `UI rendered on ${process.platform}`);
    } catch (err) {
      finish(false, String(err));
    }
  });
}
