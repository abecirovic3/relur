import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { debUpdate, INSTALL_COMMAND, type Release } from '@shared/updates';

/**
 * What Update did (spec §15.7): opened the user's terminal running the
 * install command, or the command to run by hand, with Copy: when no
 * terminal was found, and for a .deb, whose apt command needs the user.
 */
export type UpdateAction =
  | { kind: 'terminal' }
  | { kind: 'command'; command: string; link: string | null; why: string };

/** How this copy of the app was installed, as far as Update cares. */
export interface Installation {
  platform: NodeJS.Platform;
  arch: string;
  /** Running from an AppImage (`APPIMAGE` is set). */
  appImage: boolean;
  packaged: boolean;
  /** The environment the terminal gets: the user's login shell's, not the app's. */
  env: Record<string, string>;
  /** Test hook: `none` finds no terminal. */
  terminal?: string;
}

/** Linux terminals, in order, with how each runs a command (spec §15.7). */
const LINUX_TERMINALS: [string, string[]][] = [
  ['x-terminal-emulator', ['-e']],
  ['gnome-terminal', ['--']],
  ['konsole', ['-e']],
];

function onPath(name: string, env: Record<string, string>): string | null {
  for (const dir of (env.PATH ?? '').split(':').filter(Boolean)) {
    const file = path.join(dir, name);
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return file;
    } catch {
      // not here
    }
  }
  return null;
}

const byHand = (why: string): UpdateAction => ({
  kind: 'command',
  command: INSTALL_COMMAND,
  link: null,
  why,
});

/**
 * Starts the update the way the README installs (spec §15.7): never a
 * download or a replacement of its own, never sudo. The install command asks
 * before it quits the app, installs, and offers to open it again.
 */
export async function startUpdate(release: Release, at: Installation): Promise<UpdateAction> {
  if (at.platform === 'linux' && at.packaged && !at.appImage) {
    const deb = debUpdate(release, at.arch);
    return {
      kind: 'command',
      command: deb.command,
      link: deb.url,
      why: 'Installed with apt: run this in a terminal.',
    };
  }
  if (at.terminal === 'none') return byHand('No terminal found: run this in one.');
  if (at.platform === 'darwin') {
    // Terminal.app, as the user opens it; AppleScript strings escape \ and ".
    const script = INSTALL_COMMAND.replace(/[\\"]/g, '\\$&');
    const opened = await new Promise<boolean>((resolve) =>
      execFile(
        'osascript',
        [
          '-e',
          `tell application "Terminal" to do script "${script}"`,
          '-e',
          'tell application "Terminal" to activate',
        ],
        { timeout: 15_000 },
        (error) => resolve(!error),
      ),
    );
    return opened ? { kind: 'terminal' } : byHand("Terminal didn't open: run this in a terminal.");
  }
  if (at.platform === 'linux') {
    // Kept open at the end, so its output can be read.
    const command = `${INSTALL_COMMAND}; printf '\\nPress Enter to close. '; read _`;
    for (const [name, run] of LINUX_TERMINALS) {
      const file = onPath(name, at.env);
      if (!file) continue;
      try {
        // Its own session: it outlives the app, which the install command quits.
        const child = spawn(file, [...run, 'sh', '-c', command], {
          env: at.env,
          detached: true,
          stdio: 'ignore',
        });
        // A failure after the start can't be reported here; it mustn't crash the app.
        child.on('error', () => {});
        child.unref();
        return { kind: 'terminal' };
      } catch {
        // the next one
      }
    }
    return byHand('No terminal found: run this in one.');
  }
  return byHand('Run this in a terminal.');
}
