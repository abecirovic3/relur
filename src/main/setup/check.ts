import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ClaudeAccount, SetupCheck } from '@shared/setup';
import type { Env } from '../env/scrub';
import { resolveExecutable } from '../env/which';

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error: string | null;
}

/** Runs a command without a shell and collects its output; never rejects. */
function run(file: string, args: string[], options: { env: Env; cwd: string; timeoutMs: number }) {
  return new Promise<RunResult>((resolve) => {
    execFile(
      file,
      args,
      {
        env: options.env,
        cwd: options.cwd,
        timeout: options.timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: 1024 * 1024,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        const failure = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
        const code = typeof failure?.code === 'number' ? failure.code : failure ? null : 0;
        resolve({
          code,
          stdout,
          stderr,
          timedOut: Boolean(failure?.killed),
          error: failure && typeof failure.code === 'string' ? failure.message : null,
        });
      },
    );
  });
}

const lastLine = (text: string) => text.trim().split('\n').at(-1)?.trim() ?? '';
const realpath = (p: string) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

/**
 * The file Claude Code writes on first use of an account folder: `.claude.json`
 * inside it, or `~/.claude.json` for the default folder. The app only looks at
 * whether it exists (decision D12).
 */
export function claudeStateFile(configDir: string | undefined, homeDir: string): string {
  return configDir ? path.join(configDir, '.claude.json') : path.join(homeDir, '.claude.json');
}

/** Where the official installers put claude: the native installer, then Homebrew. */
export function defaultInstallLocations(homeDir: string): string[] {
  return [path.join(homeDir, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
}

export interface CheckOptions {
  profileId: string;
  /** The profile's account folder, as written in config.json. */
  folder: string;
  /** The profile's Claude command (`claude`). */
  command: string;
  /** The profile's environment (rule R3); its CLAUDE_CONFIG_DIR selects the account. */
  env: Env;
  timeouts?: { versionMs?: number; statusMs?: number };
  /** Folders to look in when the command isn't on PATH; see defaultInstallLocations. */
  installLocations?: string[];
  /** Called with the rows as each one starts and ends. */
  onProgress?: (check: SetupCheck) => void;
}

/**
 * The setup check (spec §6.11): Claude Code installed, signed in, using the
 * profile's folder. Runs only Claude Code's own commands and reads only their
 * output (decision D12).
 */
export async function runSetupCheck(options: CheckOptions): Promise<SetupCheck> {
  const { profileId, folder, command, env } = options;
  const homeDir = env.HOME || os.homedir();
  const configDir = env.CLAUDE_CONFIG_DIR || undefined;
  const check: SetupCheck = {
    profileId,
    folder,
    running: true,
    checkedAt: null,
    passed: false,
    installed: { state: 'waiting' },
    signedIn: { state: 'waiting' },
    ready: { state: 'waiting' },
    session: null,
  };
  const progress = () => options.onProgress?.(structuredClone(check));
  const finish = () => {
    check.running = false;
    check.checkedAt = Date.now();
    check.passed = check.ready.state === 'passed';
    progress();
    return check;
  };

  // 1. Installed: on the login-shell PATH, and it runs.
  check.installed = { state: 'checking', command: `${command} --version` };
  progress();
  const claude = resolveExecutable(command, env, homeDir);
  if (!claude) {
    // Installed but not on PATH: say where, so the user can add it.
    const foundAt = command.includes('/')
      ? null
      : ((options.installLocations ?? defaultInstallLocations(homeDir))
          .map((dir) => resolveExecutable(path.join(dir, command), env, homeDir))
          .find(Boolean) ?? null);
    check.installed = {
      state: 'action',
      reason: foundAt
        ? `${command} is installed at ${foundAt}, but that folder isn't on your login shell's PATH`
        : `${command} was not found on your login shell's PATH`,
      foundAt,
    };
    return finish();
  }
  const version = await run(claude, ['--version'], {
    env,
    cwd: homeDir,
    timeoutMs: options.timeouts?.versionMs ?? 10_000,
  });
  const versionText = version.stdout.trim().split('\n')[0]?.trim() ?? '';
  if (version.code !== 0 || !versionText) {
    const why = version.timedOut
      ? 'did not answer within the time limit'
      : version.error || lastLine(version.stderr) || `exited with code ${version.code}`;
    check.installed = { state: 'failed', reason: `${command} --version ${why}` };
    return finish();
  }
  check.installed = {
    state: 'passed',
    value: { version: versionText.replace(/\s*\(Claude Code\)$/, ''), path: claude },
  };

  // 2. Signed in. A folder Claude has never used has no login; `auth status`
  // would only write first-run files into it.
  if (!fs.existsSync(claudeStateFile(configDir, homeDir))) {
    check.signedIn = { state: 'action', reason: 'This folder has no Claude login yet' };
    return finish();
  }
  check.signedIn = { state: 'checking', command: `${command} auth status --json` };
  progress();
  const status = await run(claude, ['auth', 'status', '--json'], {
    env,
    cwd: homeDir,
    timeoutMs: options.timeouts?.statusMs ?? 15_000,
  });
  let parsed: Record<string, unknown> | null = null;
  try {
    const value: unknown = JSON.parse(status.stdout);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      parsed = value as Record<string, unknown>;
    }
  } catch {
    // reported below
  }
  if (!parsed || typeof parsed.loggedIn !== 'boolean') {
    const why = status.timedOut
      ? 'did not answer within the time limit'
      : lastLine(status.stderr) || lastLine(status.stdout) || `exited with code ${status.code}`;
    check.signedIn = {
      state: 'failed',
      reason: `Couldn't read the sign-in status (${why}). Update Claude Code and check again.`,
    };
    return finish();
  }
  if (!parsed.loggedIn) {
    check.signedIn = { state: 'action', reason: 'Not signed in' };
    return finish();
  }
  const text = (key: string) => (typeof parsed[key] === 'string' ? (parsed[key] as string) : null);
  const account: ClaudeAccount = {
    email: text('email'),
    plan: text('subscriptionType'),
    org: text('orgName'),
  };
  check.signedIn = { state: 'passed', value: account };

  // 3. Ready: Claude Code uses the profile's folder.
  const expected = configDir ?? path.join(homeDir, '.claude');
  const reported = text('configDirectory');
  if (!reported) {
    check.ready = { state: 'failed', reason: "Claude Code didn't report its config folder" };
  } else if (realpath(reported) !== realpath(expected)) {
    check.ready = {
      state: 'failed',
      reason: `Claude Code uses ${reported}, not ${expected}. Something in your shell sets CLAUDE_CONFIG_DIR.`,
    };
  } else {
    check.ready = { state: 'passed', value: { configDirectory: reported } };
  }
  return finish();
}
