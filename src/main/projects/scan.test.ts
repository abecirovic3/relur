import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFixture, type Fixture } from '../test-support/git-fixtures';
import { mapLimit, scanForRepositories } from './scan';

let fx: Fixture;
let folder: string;

beforeAll(() => {
  fx = createFixture();
  folder = path.join(fx.root, 'Projects');
  const repo = (name: string) => fx.localRepo(path.join('Projects', name));
  repo('beta');
  const alpha = repo('alpha');
  // A linked worktree and a submodule-like folder: .git is a file.
  fx.git(alpha, 'worktree', 'add', '-q', '-b', 'wt', path.join(folder, 'alpha-wt'));
  fs.mkdirSync(path.join(folder, 'sub'));
  fs.writeFileSync(path.join(folder, 'sub', '.git'), 'gitdir: ../alpha/.git/modules/sub\n');
  // Bare, hidden, node_modules, .worktrees, plain folders and files.
  fx.git(fx.root, 'clone', '-q', '--bare', alpha, path.join(folder, 'bare.git'));
  repo('.hidden-repo');
  repo('node_modules');
  fs.mkdirSync(path.join(folder, '.worktrees', 'alpha'), { recursive: true });
  fs.mkdirSync(path.join(folder, 'docs'));
  fs.writeFileSync(path.join(folder, 'notes.txt'), 'x');
  // Only one level down: a repository two levels down is not offered.
  fx.localRepo(path.join('Projects', 'group', 'deep'));
});
afterAll(() => fx.cleanup());

describe('scanForRepositories', () => {
  it('offers the repositories one level down, sorted by name', () => {
    const scan = scanForRepositories(folder);
    expect(scan.repositories).toEqual([path.join(folder, 'alpha'), path.join(folder, 'beta')]);
  });

  it('skips hidden folders, node_modules, linked worktrees and bare repositories', () => {
    const skipped = Object.fromEntries(
      scanForRepositories(folder).skipped.map((s) => [path.basename(s.path), s.reason]),
    );
    expect(skipped).toEqual({
      '.hidden-repo': 'hidden',
      '.worktrees': 'hidden',
      'alpha-wt': 'linked-worktree',
      sub: 'linked-worktree',
      'bare.git': 'bare-repository',
      node_modules: 'node_modules',
    });
  });
});

describe('mapLimit', () => {
  it('keeps the order and runs at most `limit` at once', async () => {
    let running = 0;
    let most = 0;
    const results = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, n * 5));
      running--;
      return n * 10;
    });
    expect(results).toEqual([50, 10, 40, 20, 30]);
    expect(most).toBe(2);
  });
});
