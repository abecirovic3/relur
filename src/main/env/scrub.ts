import { BRAND } from '@shared/brand';

export type Env = Record<string, string>;

/**
 * Variables that describe the process that launched the app rather than the
 * user's setup: a Claude Code session the app was started from (which would
 * otherwise pass its CLAUDE_CONFIG_DIR, and so its account, to every profile),
 * a workspace of this app (or of the old app, §3.5), npm or Electron tooling,
 * and on Linux the AppImage runtime and the launch itself: Chromium's desktop
 * entry (another Electron app, an editor say, would take it as its own) and
 * the one-off startup and activation tokens (spec §15.2). The login shell
 * re-adds anything the user sets in their shell profile.
 */
const INHERITED_PREFIXES = [
  BRAND.envPrefix,
  BRAND.legacy.envPrefix,
  'CLAUDE_',
  'ANTHROPIC_',
  'ELECTRON_',
  'npm_',
  'VITE_',
];
const INHERITED_NAMES = [
  'CLAUDECODE',
  'NODE_ENV',
  'INIT_CWD',
  'APPDIR',
  'APPIMAGE',
  'ARGV0',
  'OWD',
  'CHROME_DESKTOP',
  'GIO_LAUNCHED_DESKTOP_FILE',
  'GIO_LAUNCHED_DESKTOP_FILE_PID',
  'BAMF_DESKTOP_FILE_HINT',
  'DESKTOP_STARTUP_ID',
  'XDG_ACTIVATION_TOKEN',
];

/** Per-shell bookkeeping that must not carry over to processes started elsewhere. */
const SHELL_STATE = ['_', 'PWD', 'OLDPWD', 'SHLVL'];

export function scrubInherited(env: NodeJS.ProcessEnv): Env {
  const out: Env = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (INHERITED_NAMES.includes(key) || INHERITED_PREFIXES.some((p) => key.startsWith(p))) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function dropShellState(env: Env): Env {
  const out = { ...env };
  for (const key of SHELL_STATE) delete out[key];
  return out;
}
