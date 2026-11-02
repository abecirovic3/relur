import fs from 'node:fs';
import { app } from 'electron';

/**
 * Why Chromium's sandbox is off, or null while it's on (spec §15.6). The app
 * never turns it off, but electron-builder's AppImage launcher adds
 * --no-sandbox when `unshare -Ur true` fails, as it does on Ubuntu 23.10 and
 * later without the AppArmor profile. On Linux, a renderer in the main
 * process's PID namespace isn't sandboxed either: both of Chromium's Linux
 * sandboxes (user namespaces, setuid chrome-sandbox) give it one of its own.
 * A namespace that can't be read counts as sandboxed: Chromium makes its
 * sandboxed processes undumpable, which hides their /proc/<pid>/ns.
 */
export function sandboxOff(options: {
  noSandboxSwitch: boolean;
  platform: NodeJS.Platform;
  /** The renderers' process ids. */
  renderers: number[];
  /** readlink of /proc/<pid>/ns/<ns>; throws when it can't be read. */
  readNamespace?: (pid: number | 'self', ns: string) => string;
}): string | null {
  if (options.noSandboxSwitch) return 'started with --no-sandbox';
  if (options.platform !== 'linux') return null;
  const read = options.readNamespace ?? ((pid, ns) => fs.readlinkSync(`/proc/${pid}/ns/${ns}`));
  let own: string;
  try {
    own = read('self', 'pid');
  } catch {
    return null;
  }
  for (const pid of options.renderers) {
    let theirs: string;
    try {
      theirs = read(pid, 'pid');
    } catch {
      continue;
    }
    if (theirs === own) return `renderer ${pid} runs in the main process's PID namespace`;
  }
  return null;
}

/** sandboxOff for this app, now: its command line and its renderers. */
export function chromiumSandboxOff(): string | null {
  return sandboxOff({
    noSandboxSwitch: app.commandLine.hasSwitch('no-sandbox'),
    platform: process.platform,
    renderers: app
      .getAppMetrics()
      .filter((metric) => metric.type === 'Tab')
      .map((metric) => metric.pid),
  });
}
