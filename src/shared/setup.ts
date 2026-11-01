import type { Profile } from './schemas';
import { shellQuote } from './shell';

/** The folder Claude Code uses when `CLAUDE_CONFIG_DIR` isn't set. */
export const DEFAULT_ACCOUNT_FOLDER = '~/.claude';

/** A profile's Claude account folder, as written in config.json (spec §3.1). */
export function accountFolder(profile: Pick<Profile, 'env'>): string {
  return profile.env.CLAUDE_CONFIG_DIR || DEFAULT_ACCOUNT_FOLDER;
}

/** One row of the setup check (spec §6.11). */
export type SetupStep<T> =
  /** A row before it didn't pass, or the check hasn't run yet. */
  | { state: 'waiting' }
  | { state: 'checking'; command: string }
  | { state: 'passed'; value: T }
  /** The user can fix it from the check: install, or sign in. */
  | { state: 'action'; reason: string }
  | { state: 'failed'; reason: string };

export interface ClaudeAccount {
  email: string | null;
  plan: string | null;
  org: string | null;
}

export interface SetupCheck {
  profileId: string;
  /** The profile's account folder, as written in config.json. */
  folder: string;
  /** Whether a check is running now; the rows show how far it got. */
  running: boolean;
  /** When the last complete check finished (ms since epoch); null before the first. */
  checkedAt: number | null;
  /** Whether the last complete check passed; it stays while a new one runs. */
  passed: boolean;
  installed: SetupStep<{ version: string; path: string }> & {
    /** When claude isn't on PATH: where an installer put it, if anywhere. */
    foundAt?: string | null;
  };
  signedIn: SetupStep<ClaudeAccount>;
  ready: SetupStep<{ configDirectory: string }>;
  /** The latest install or sign-in command started from the check, if any. */
  session: SetupSession | null;
}

export function setupPassed(check: SetupCheck | null | undefined): boolean {
  return check?.passed ?? false;
}

/** The status bar's short warning for a check that hasn't passed (spec §6.5), or null. */
export function setupWarning(check: SetupCheck | null | undefined): string | null {
  if (!check || check.running || setupPassed(check)) return null;
  if (check.installed.state === 'action' || check.installed.state === 'failed') {
    return 'claude not found';
  }
  if (check.signedIn.state === 'action' || check.signedIn.state === 'failed') {
    return 'not signed in';
  }
  if (check.ready.state === 'failed') return 'wrong config folder';
  return null;
}

/** An official way to install Claude Code (spec §6.11); the command is shown and run verbatim. */
export interface InstallMethod {
  id: 'native' | 'brew';
  label: string;
  command: string;
  note: string;
  recommended: boolean;
}

/** macOS and Linux. Windows methods arrive with M7. */
export const INSTALL_METHODS: readonly InstallMethod[] = [
  {
    id: 'native',
    label: 'Native installer',
    command: 'curl -fsSL https://claude.ai/install.sh | bash',
    note: 'Updates itself in the background',
    recommended: true,
  },
  {
    id: 'brew',
    label: 'Homebrew',
    command: 'brew install --cask claude-code',
    note: "Doesn't update itself: run brew upgrade",
    recommended: false,
  },
];

/** Claude Code's own sign-in with the profile's Claude command, run with its environment. */
export function signInCommand(claudeCommand: string): string {
  return `${shellQuote(claudeCommand)} auth login`;
}

/** The install or sign-in command of a profile's setup check, and its terminal session. */
export interface SetupSession {
  sessionId: string;
  step: 'install' | 'sign-in';
  command: string;
}
