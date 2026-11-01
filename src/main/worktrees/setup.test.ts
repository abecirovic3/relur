import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Project } from '@shared/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  allocatePorts,
  commandScript,
  LEGACY_REPO_CONFIG,
  REPO_CONFIG,
  runCommands,
  setupPlan,
} from './setup';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const project = (setup?: Project['setup']): Project => ({
  id: 'api',
  profileId: 'work',
  name: 'api',
  repoPath: dir,
  remote: null,
  setup,
  skillsOff: [],
});
const writeRepoConfig = (value: unknown) => {
  fs.mkdirSync(path.dirname(path.join(dir, REPO_CONFIG)), { recursive: true });
  fs.writeFileSync(
    path.join(dir, REPO_CONFIG),
    typeof value === 'string' ? value : JSON.stringify(value),
  );
};

describe('setupPlan (spec §8.3)', () => {
  it('has nothing to run by default', () => {
    expect(setupPlan(project(), dir)).toMatchObject({ source: null, setup: [], ports: 10 });
  });

  it("uses the app's commands when the repository has no file", () => {
    const plan = setupPlan(project({ setup: ['npm ci'], teardown: ['echo bye'], ports: 4 }), dir);
    expect(plan).toMatchObject({
      source: 'app',
      setup: ['npm ci'],
      teardown: ['echo bye'],
      ports: 4,
      startClaude: 'after-setup',
    });
  });

  it("prefers the repository's file, with per-OS variants", () => {
    writeRepoConfig({
      setup: { default: ['./setup.sh'], windows: ['setup.ps1'] },
      teardown: ['./teardown.sh'],
      ports: 3,
      setupTimeoutSec: 60,
      startClaude: 'parallel',
    });
    const plan = setupPlan(project({ setup: ['ignored'], teardown: [] }), dir, 'darwin');
    expect(plan).toMatchObject({
      source: 'repo',
      setup: ['./setup.sh'],
      teardown: ['./teardown.sh'],
      ports: 3,
      setupTimeoutSec: 60,
      teardownTimeoutSec: 120,
      startClaude: 'parallel',
    });
    expect(setupPlan(project(), dir, 'win32').setup).toEqual(['setup.ps1']);
  });

  it("still reads the old app's file, and prefers the new one", () => {
    const write = (rel: string, setup: string[]) => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), JSON.stringify({ setup }));
    };
    write(LEGACY_REPO_CONFIG, ['./old.sh']);
    expect(setupPlan(project(), dir)).toMatchObject({
      source: 'repo',
      file: LEGACY_REPO_CONFIG,
      setup: ['./old.sh'],
    });
    write(REPO_CONFIG, ['./new.sh']);
    expect(setupPlan(project(), dir)).toMatchObject({
      source: 'repo',
      file: REPO_CONFIG,
      setup: ['./new.sh'],
    });
  });

  it('reports a repository file it cannot use, and runs nothing', () => {
    writeRepoConfig('{ not json');
    expect(setupPlan(project(), dir)).toMatchObject({
      source: 'repo',
      setup: [],
      error: expect.stringMatching(/^\.\w+\/config\.json: /),
    });
    writeRepoConfig({ setup: 'npm ci' });
    expect(setupPlan(project(), dir).error).toMatch(/setup/);
  });
});

describe('commandScript', () => {
  const run = (commands: string[]) => {
    try {
      return {
        code: 0,
        out: execFileSync('/bin/sh', ['-c', commandScript(commands, 'Setup')], {
          cwd: dir,
          encoding: 'utf8',
        }),
      };
    } catch (error) {
      const e = error as { status: number; stdout: string };
      return { code: e.status, out: e.stdout };
    }
  };

  it('runs the commands in order, showing each, and says it finished', () => {
    const { code, out } = run(['echo one > a.txt', "printf '%s' \"it's\" >> a.txt"]);
    expect(code).toBe(0);
    expect(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe("one\nit's");
    expect(out).toContain('$ echo one > a.txt');
    expect(out).toContain('✓ Setup finished');
  });

  it('stops at the first failure with its exit code', () => {
    const { code, out } = run(['echo first', 'exit 3', 'touch never']);
    expect(code).toBe(3);
    expect(out).toContain('✕ Setup failed (exit 3)');
    expect(fs.existsSync(path.join(dir, 'never'))).toBe(false);
  });
});

describe('runCommands', () => {
  const base = {
    shell: '/bin/sh',
    cwd: '',
    env: { PATH: process.env.PATH ?? '' },
    label: 'Teardown',
  };
  it('reports success, failure with output, and a timeout', async () => {
    expect(
      await runCommands({ ...base, cwd: dir, commands: ['true'], timeoutSec: 5 }),
    ).toMatchObject({ ok: true });
    const failed = await runCommands({
      ...base,
      cwd: dir,
      commands: ['echo oops >&2; exit 2'],
      timeoutSec: 5,
    });
    expect(failed).toMatchObject({ ok: false, message: 'Teardown failed (exit 2)' });
    expect(failed.output).toContain('oops');
    const slow = await runCommands({ ...base, cwd: dir, commands: ['sleep 5'], timeoutSec: 1 });
    expect(slow).toMatchObject({ ok: false, message: 'Teardown timed out after 1 s' });
  });
});

describe('allocatePorts (spec §8.4)', () => {
  const range = { start: 20000, end: 20049 };
  it('takes the lowest free aligned block and fails when none is left', () => {
    expect(allocatePorts(10, range, [])).toEqual({ base: 20000, count: 10 });
    expect(
      allocatePorts(10, range, [
        { base: 20000, count: 10 },
        { base: 20020, count: 10 },
      ]),
    ).toEqual({ base: 20010, count: 10 });
    // A block of another size overlapping the next one is skipped.
    expect(allocatePorts(10, range, [{ base: 20000, count: 15 }])).toEqual({
      base: 20020,
      count: 10,
    });
    const full = [0, 1, 2, 3, 4].map((i) => ({ base: 20000 + i * 10, count: 10 }));
    expect(() => allocatePorts(10, range, full)).toThrow(/No free block/);
  });
});
