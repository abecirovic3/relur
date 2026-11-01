import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setupPassed, setupWarning } from '@shared/setup';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CheckOptions, runSetupCheck } from './check';

let home: string;
let bin: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-check-'));
  bin = path.join(home, 'bin');
  fs.mkdirSync(bin);
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

/**
 * A stand-in for Claude Code. `auth status` prints what a real one prints;
 * the account values are made up.
 */
function fakeClaude(options: { auth?: string; version?: string } = {}) {
  const version = options.version ?? `echo '9.9.9 (Claude Code)'`;
  const auth =
    options.auth ??
    `if [ -f "$dir/fake-login" ]; then
  printf '{"loggedIn":true,"authMethod":"claude.ai","email":"test@example.com","orgName":"Example Org","subscriptionType":"pro","configDirectory":"%s"}\\n' "$dir"
else
  printf '{"loggedIn":false,"authMethod":"none","configDirectory":"%s"}\\n' "$dir"
  exit 1
fi`;
  fs.writeFileSync(
    path.join(bin, 'claude'),
    `#!/bin/sh
dir="\${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
echo "$@" >> "$HOME/claude-calls.txt"
case "$1" in
  --version) ${version} ;;
  auth) ${auth} ;;
esac
`,
    { mode: 0o755 },
  );
}

const calls = () => {
  try {
    return fs.readFileSync(path.join(home, 'claude-calls.txt'), 'utf8').trim().split('\n');
  } catch {
    return [];
  }
};

/** A Claude config folder, used before (it has `.claude.json`) or not, signed in or not. */
function folder(name: string, state: { used?: boolean; signedIn?: boolean } = {}) {
  const dir = path.join(home, name);
  fs.mkdirSync(dir, { recursive: true });
  if (state.used ?? true) fs.writeFileSync(path.join(dir, '.claude.json'), '{}');
  if (state.signedIn) fs.writeFileSync(path.join(dir, 'fake-login'), '');
  return dir;
}

const check = (env: Record<string, string> = {}, extra: Partial<CheckOptions> = {}) =>
  runSetupCheck({
    profileId: 'p',
    folder: '~/.claude-p',
    command: 'claude',
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, ...env },
    ...extra,
  });

describe('runSetupCheck', () => {
  it('needs an install when claude is not on PATH, and runs nothing', async () => {
    const result = await check({}, { installLocations: [] });
    expect(result.installed.state).toBe('action');
    expect(result.signedIn.state).toBe('waiting');
    expect(result.ready.state).toBe('waiting');
    expect(result.running).toBe(false);
    expect(result.checkedAt).not.toBeNull();
    expect(setupWarning(result)).toBe('claude not found');
    expect(setupPassed(result)).toBe(false);
  });

  it('says where claude is when it is installed but not on PATH', async () => {
    fakeClaude();
    const elsewhere = path.join(home, '.local', 'bin');
    fs.mkdirSync(elsewhere, { recursive: true });
    fs.renameSync(path.join(bin, 'claude'), path.join(elsewhere, 'claude'));
    const result = await check({}, { installLocations: [path.join(home, 'nothing'), elsewhere] });
    expect(result.installed).toMatchObject({
      state: 'action',
      foundAt: path.join(elsewhere, 'claude'),
    });
    expect(calls()).toEqual([]);
  });

  it('needs a sign-in when auth status reports logged out', async () => {
    fakeClaude();
    const dir = folder('.claude-p');
    const result = await check({ CLAUDE_CONFIG_DIR: dir });
    expect(result.installed).toEqual({
      state: 'passed',
      value: { version: '9.9.9', path: path.join(bin, 'claude') },
    });
    expect(result.signedIn.state).toBe('action');
    expect(result.ready.state).toBe('waiting');
    expect(setupWarning(result)).toBe('not signed in');
    expect(calls()).toEqual(['--version', 'auth status --json']);
  });

  it('passes when signed in to the profile folder, and reports the account', async () => {
    fakeClaude();
    const dir = folder('.claude-p', { signedIn: true });
    const result = await check({ CLAUDE_CONFIG_DIR: dir });
    expect(result.signedIn).toEqual({
      state: 'passed',
      value: { email: 'test@example.com', plan: 'pro', org: 'Example Org' },
    });
    expect(result.ready).toEqual({ state: 'passed', value: { configDirectory: dir } });
    expect(setupPassed(result)).toBe(true);
    expect(setupWarning(result)).toBeNull();
  });

  it('uses ~/.claude and ~/.claude.json when CLAUDE_CONFIG_DIR is not set', async () => {
    fakeClaude();
    fs.mkdirSync(path.join(home, '.claude'));
    fs.writeFileSync(path.join(home, '.claude', 'fake-login'), '');
    expect((await check()).signedIn.state).toBe('action');
    expect(calls()).toEqual(['--version']);

    fs.writeFileSync(path.join(home, '.claude.json'), '{}');
    const result = await check();
    expect(result.ready.state).toBe('passed');
  });

  it("doesn't run auth status in a folder Claude has never used", async () => {
    fakeClaude();
    const dir = folder('.claude-new', { used: false });
    const result = await check({ CLAUDE_CONFIG_DIR: dir });
    expect(result.signedIn.state).toBe('action');
    expect(calls()).toEqual(['--version']);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('fails Ready when Claude Code reports another config folder', async () => {
    fakeClaude({
      auth: `printf '{"loggedIn":true,"configDirectory":"/somewhere/else"}\\n'`,
    });
    const dir = folder('.claude-p');
    const result = await check({ CLAUDE_CONFIG_DIR: dir });
    expect(result.signedIn.state).toBe('passed');
    expect(result.ready.state).toBe('failed');
    expect(setupWarning(result)).toBe('wrong config folder');
  });

  it('fails when claude --version hangs, after the timeout', async () => {
    fakeClaude({ version: 'exec sleep 30' });
    const started = Date.now();
    const result = await check({}, { timeouts: { versionMs: 300 } });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(result.installed.state).toBe('failed');
    expect(result.installed.state === 'failed' && result.installed.reason).toMatch(/time limit/);
  });

  it('fails Signed in when this version has no auth status', async () => {
    fakeClaude({ auth: `echo "error: unknown command 'auth'" >&2; exit 1` });
    const dir = folder('.claude-p');
    const result = await check({ CLAUDE_CONFIG_DIR: dir });
    expect(result.signedIn.state).toBe('failed');
    expect(result.signedIn.state === 'failed' && result.signedIn.reason).toMatch(/unknown command/);
  });

  it('reports each row as it starts', async () => {
    fakeClaude();
    const dir = folder('.claude-p', { signedIn: true });
    const seen: string[] = [];
    await check(
      { CLAUDE_CONFIG_DIR: dir },
      {
        onProgress: (c) => seen.push(`${c.installed.state}/${c.signedIn.state}/${c.running}`),
      },
    );
    expect(seen).toEqual(['checking/waiting/true', 'passed/checking/true', 'passed/passed/false']);
  });
});
