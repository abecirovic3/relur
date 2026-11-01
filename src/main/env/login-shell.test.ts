import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { envVar } from '@shared/brand';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveLoginShellEnv } from './login-shell';

let dir: string;
let noisyShell: string;
let slowShell: string;

function script(name: string, body: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'login-shell-'));
  // Startup files that print to stdout are common; the result must survive them.
  noisyShell = script(
    'noisy-sh',
    'echo "Welcome {not json"\necho "warning" >&2\nexec /bin/sh "$@"',
  );
  slowShell = script('slow-sh', 'sleep 5');
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const parentEnv = () => ({
  PATH: process.env.PATH,
  HOME: dir,
  KEEP_ME: 'yes',
  CLAUDECODE: '1',
  CLAUDE_CONFIG_DIR: '/from/parent/session',
  ANTHROPIC_API_KEY: 'sk-parent',
  [envVar('WORKSPACE_ID')]: 'ws_parent',
  npm_lifecycle_event: 'dev',
});

describe('resolveLoginShellEnv', () => {
  it('returns the shell environment despite noisy startup output', async () => {
    const result = await resolveLoginShellEnv({ shell: noisyShell, parentEnv: parentEnv() });
    expect(result.error).toBeUndefined();
    expect(result.source).toBe('login-shell');
    expect(result.env.KEEP_ME).toBe('yes');
    expect(result.env.PATH).toBeTruthy();
  });

  it('drops variables inherited from the launching process and shell bookkeeping', async () => {
    const { env } = await resolveLoginShellEnv({ shell: noisyShell, parentEnv: parentEnv() });
    for (const key of [
      'CLAUDECODE',
      'CLAUDE_CONFIG_DIR',
      'ANTHROPIC_API_KEY',
      envVar('WORKSPACE_ID'),
      'npm_lifecycle_event',
      'ELECTRON_RUN_AS_NODE',
      'PWD',
      'SHLVL',
    ]) {
      expect(env, key).not.toHaveProperty(key);
    }
  });

  it('falls back to the scrubbed app environment when the shell hangs', async () => {
    const result = await resolveLoginShellEnv({
      shell: slowShell,
      parentEnv: parentEnv(),
      timeoutMs: 200,
    });
    expect(result.source).toBe('fallback');
    expect(result.error).toMatch(/did not finish/);
    expect(result.env.KEEP_ME).toBe('yes');
    expect(result.env).not.toHaveProperty('CLAUDE_CONFIG_DIR');
  });

  it('falls back when the shell does not exist', async () => {
    const result = await resolveLoginShellEnv({
      shell: path.join(dir, 'missing-sh'),
      parentEnv: parentEnv(),
    });
    expect(result.source).toBe('fallback');
    expect(result.error).toMatch(/could not run/);
  });

  // Each real shell that is installed (the Docker Linux check has all three):
  // its own startup file adds to PATH and sets a value with a newline.
  const startup: Record<string, [file: string, body: string]> = {
    bash: ['.bash_profile', 'export PATH="$HOME/bash-bin:$PATH"\nexport MULTI="a\nb"'],
    zsh: ['.zprofile', 'export PATH="$HOME/zsh-bin:$PATH"\nexport MULTI="a\nb"'],
    fish: ['.config/fish/config.fish', 'set -gx PATH $HOME/fish-bin $PATH\nset -gx MULTI "a\nb"'],
  };
  for (const [name, [file, body]] of Object.entries(startup)) {
    let shell: string | null = null;
    try {
      shell = execFileSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).trim() || null;
    } catch {
      // not installed here
    }
    it.runIf(shell)(`reads PATH and multi-line values from ${name}'s startup files`, async () => {
      const home = fs.mkdtempSync(path.join(dir, `${name}-`));
      fs.mkdirSync(path.dirname(path.join(home, file)), { recursive: true });
      fs.writeFileSync(path.join(home, file), `${body}\n`);
      const result = await resolveLoginShellEnv({
        shell: shell as string,
        parentEnv: {
          PATH: '/usr/bin:/bin',
          HOME: home,
          ZDOTDIR: home,
          XDG_CONFIG_HOME: path.join(home, '.config'),
        },
      });
      expect(result.error).toBeUndefined();
      expect(result.env.PATH?.split(':')[0]).toBe(path.join(home, `${name}-bin`));
      expect(result.env.MULTI).toBe('a\nb');
    });
  }
});
