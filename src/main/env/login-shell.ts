import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { dropShellState, type Env, scrubInherited } from './scrub';

export interface LoginShellEnv {
  env: Env;
  shell: string;
  /** `fallback` means the shell couldn't be run and the app's own environment is used. */
  source: 'login-shell' | 'fallback';
  error?: string;
}

interface Options {
  parentEnv?: NodeJS.ProcessEnv;
  shell?: string;
  timeoutMs?: number;
}

export function defaultShell(env: NodeJS.ProcessEnv = process.env): string {
  if (env.SHELL) return env.SHELL;
  try {
    const { shell } = os.userInfo();
    if (shell) return shell;
  } catch {
    // no passwd entry
  }
  return '/bin/sh';
}

/**
 * The environment a terminal would have (spec §15.2): GUI apps on macOS and
 * some Linux desktops don't inherit the shell's PATH. Runs `$SHELL -i -l -c`
 * and has it print its environment with `env -0` (NUL-separated, so values
 * may hold newlines) between random markers, so output from shell startup
 * files can't corrupt the result. No Node is needed: the packaged app can't
 * run itself as Node (its RunAsNode fuse is off).
 */
export function resolveLoginShellEnv(options: Options = {}): Promise<LoginShellEnv> {
  const parent = scrubInherited(options.parentEnv ?? process.env);
  const shell = options.shell ?? defaultShell(options.parentEnv);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const marker = randomUUID();
  const command = `printf '%s' ${marker}; /usr/bin/env -0; printf '%s' ${marker}`;

  const fallback = (error: string): LoginShellEnv => ({
    env: dropShellState(parent),
    shell,
    source: 'fallback',
    error,
  });

  return new Promise((resolve) => {
    const out: Buffer[] = [];
    let stderr = '';
    let settled = false;
    const settle = (result: LoginShellEnv) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const child = spawn(shell, ['-i', '-l', '-c', command], {
      env: parent,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own session: an interactive shell must not touch the app's terminal, if any.
      detached: true,
    });
    const timer = setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        // already gone
      }
      settle(fallback(`${shell} did not finish within ${timeoutMs} ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      out.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => settle(fallback(`could not run ${shell}: ${err.message}`)));
    child.on('close', (code) => {
      const stdout = Buffer.concat(out).toString('utf8');
      const start = stdout.indexOf(marker);
      const end = stdout.lastIndexOf(marker);
      if (start === -1 || end <= start) {
        const detail = stderr.trim().split('\n').slice(-3).join(' ');
        return settle(
          fallback(
            `${shell} exited with ${code} without printing its environment. ${detail}`.trim(),
          ),
        );
      }
      const env: Env = {};
      for (const entry of stdout.slice(start + marker.length, end).split('\0')) {
        const at = entry.indexOf('=');
        if (at > 0) env[entry.slice(0, at)] = entry.slice(at + 1);
      }
      if (!env.PATH) {
        return settle(fallback(`could not read the environment from ${shell}`));
      }
      settle({ env: dropShellState(env), shell, source: 'login-shell' });
    });
  });
}
