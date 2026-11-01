import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigStore } from '../config/store';
import { EnvService } from '../env/service';
import { TerminalService } from '../services/terminals';
import { SessionHost } from '../sessions/host';
import { SetupService } from './service';

vi.mock('electron', () => ({ app: { getLocale: () => 'en-US', getVersion: () => '0.0.0' } }));

let home: string;
let env: EnvService;
let config: ConfigStore;
let setup: SetupService;

const versionCalls = () =>
  fs.existsSync(path.join(home, 'calls.txt'))
    ? fs.readFileSync(path.join(home, 'calls.txt'), 'utf8').split('\n').filter(Boolean).length
    : 0;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-service-'));
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin);
  // Signed in to ~/.claude-ok only; the values are made up.
  fs.writeFileSync(
    path.join(bin, 'claude'),
    `#!/bin/sh
case "$1" in
  --version) echo x >> "$HOME/calls.txt"; echo '9.9.9 (Claude Code)' ;;
  auth)
    if [ "$2" = login ]; then echo "Login successful."; touch "$CLAUDE_CONFIG_DIR/fake-login"; exit 0; fi
    if [ -f "$CLAUDE_CONFIG_DIR/fake-login" ]; then
      printf '{"loggedIn":true,"email":"test@example.com","configDirectory":"%s"}' "$CLAUDE_CONFIG_DIR"; exit 0
    fi
    case "$CLAUDE_CONFIG_DIR" in
    */.claude-ok) printf '{"loggedIn":true,"email":"test@example.com","configDirectory":"%s"}' "$CLAUDE_CONFIG_DIR" ;;
    *) printf '{"loggedIn":false}'; exit 1 ;;
  esac ;;
esac
`,
    { mode: 0o755 },
  );
  for (const name of ['.claude-ok', '.claude-out']) {
    fs.mkdirSync(path.join(home, name));
    fs.writeFileSync(path.join(home, name, '.claude.json'), '{}');
  }
  const file = path.join(home, 'config.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      profiles: [
        { id: 'ok', name: 'Ok', env: { CLAUDE_CONFIG_DIR: path.join(home, '.claude-ok') } },
        { id: 'out', name: 'Out', env: { CLAUDE_CONFIG_DIR: path.join(home, '.claude-out') } },
      ],
    }),
  );
  config = new ConfigStore(file);
  config.load();
  env = new EnvService(
    config,
    Promise.resolve({
      env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home },
      shell: '/bin/sh',
      source: 'login-shell',
    }),
  );
  setup = new SetupService(config, env, null);
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe('SetupService', () => {
  it('joins a running check and caches the result', async () => {
    const [a, b] = await Promise.all([setup.check('ok'), setup.check('ok')]);
    expect(a).toBe(b);
    expect(versionCalls()).toBe(1);
    expect(setup.get('ok')?.ready.state).toBe('passed');
    expect(setup.passed('ok')).toBe(true);
    expect(versionCalls()).toBe(1);
  });

  it('re-checks only profiles that have not passed when the window gains focus', async () => {
    await setup.check('ok');
    await setup.check('out');
    expect(setup.passed('out')).toBe(false);
    const changed: string[] = [];
    setup.onChange((id) => changed.push(id));
    setup.checkUnpassedOnFocus();
    await setup.check('out'); // joins the focus check
    expect(new Set(changed)).toEqual(new Set(['out']));
    expect(versionCalls()).toBe(3);
  });

  it('drops the result of a removed profile', async () => {
    await setup.check('out');
    config.update((raw) => {
      raw.profiles = (raw.profiles as { id: string }[]).filter((p) => p.id !== 'out');
    });
    expect(setup.passed('out')).toBe(false);
    await expect(setup.check('out')).rejects.toThrow(/Unknown profile/);
  });

  it('signs in through claude auth login in a terminal session, then checks again', async () => {
    const host = new SessionHost({ killTimeoutMs: 500 });
    const terminals = new TerminalService(config, env, host);
    const withTerminals = new SetupService(config, env, terminals);
    try {
      await withTerminals.check('out');
      expect(withTerminals.passed('out')).toBe(false);
      const session = await withTerminals.signIn('out');
      expect(session.kind).toBe('setup');
      expect(withTerminals.get('out')?.session).toEqual({
        sessionId: session.id,
        step: 'sign-in',
        command: 'claude auth login',
      });
      await expect(withTerminals.signIn('out')).rejects.toThrow(/still running/);
      const exited = await host.waitForExit(session.id);
      expect(exited.exitCode).toBe(0);
      expect(host.scrollback(session.id)).toContain('Login successful.');
      await vi.waitFor(() => expect(withTerminals.passed('out')).toBe(true));
    } finally {
      await host.stopAll();
    }
  });
});
