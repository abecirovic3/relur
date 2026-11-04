import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Git } from '../git/git';
import { createFixture, type Fixture } from '../test-support/git-fixtures';
import {
  createRepository,
  enclosingRepository,
  FIRST_COMMIT_MESSAGE,
  NEW_REPO_GITIGNORE,
  targetProblem,
} from './create';

let fx: Fixture;
let git: Git;

beforeAll(() => {
  fx = createFixture();
  git = new Git({ gitPath: 'git', env: fx.env });
});
afterAll(() => fx.cleanup());

const options = { name: 'shop', baseBranch: 'trunk', readme: true, gitignore: true };

describe('targetProblem (spec §6.1)', () => {
  it('accepts a missing folder or an empty one, and refuses anything else', () => {
    const empty = path.join(fx.root, 'empty');
    fs.mkdirSync(empty);
    const full = path.join(fx.root, 'full');
    fs.mkdirSync(full);
    fs.writeFileSync(path.join(full, 'a'), '');
    const file = path.join(fx.root, 'a-file');
    fs.writeFileSync(file, '');
    expect(targetProblem(path.join(fx.root, 'missing'))).toBeNull();
    expect(targetProblem(empty)).toBeNull();
    expect(targetProblem(full)).toMatch(/already exists and isn't empty/);
    expect(targetProblem(file)).toMatch(/isn't a folder/);
  });
});

describe('enclosingRepository', () => {
  it('finds the repository a folder is inside, and null outside any', async () => {
    const repo = fx.localRepo('outer');
    fs.mkdirSync(path.join(repo, 'sub'));
    expect(await enclosingRepository(git, path.join(repo, 'sub'))).toBe(repo);
    const plain = path.join(fx.root, 'plain');
    fs.mkdirSync(plain);
    expect(await enclosingRepository(git, plain)).toBeNull();
    expect(await enclosingRepository(git, path.join(fx.root, 'missing'))).toBeNull();
  });
});

describe('createRepository (spec §6.1)', () => {
  it('makes the folder, the base branch and a first commit with README and .gitignore', async () => {
    const dir = path.join(fx.root, 'new-one');
    await createRepository(git, dir, options);
    expect(fx.git(dir, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('trunk');
    expect(fx.git(dir, 'log', '--format=%s|%an|%ae').trim()).toBe(
      `${FIRST_COMMIT_MESSAGE}|Test|test@example.com`,
    );
    expect(fx.git(dir, 'ls-files').trim().split('\n').sort()).toEqual(['.gitignore', 'README.md']);
    expect(fs.readFileSync(path.join(dir, 'README.md'), 'utf8')).toBe('# shop\n');
    expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')).toBe(NEW_REPO_GITIGNORE);
    expect(fx.git(dir, 'status', '--porcelain')).toBe('');
  });

  it('uses the identity of the environment it runs with (the profile’s)', async () => {
    const dir = path.join(fx.root, 'identity');
    const own = new Git({
      gitPath: 'git',
      env: { ...fx.env, GIT_AUTHOR_NAME: 'Profile Name', GIT_AUTHOR_EMAIL: 'p@example.com' },
    });
    await createRepository(own, dir, options);
    expect(fx.git(dir, 'log', '--format=%an <%ae>').trim()).toBe('Profile Name <p@example.com>');
  });

  it('makes an empty commit without README and .gitignore, also in an existing empty folder', async () => {
    const dir = path.join(fx.root, 'bare-start');
    fs.mkdirSync(dir);
    await createRepository(git, dir, { ...options, readme: false, gitignore: false });
    expect(fx.git(dir, 'log', '--format=%s').trim()).toBe(FIRST_COMMIT_MESSAGE);
    expect(fx.git(dir, 'ls-files')).toBe('');
    expect(fs.readdirSync(dir)).toEqual(['.git']);
  });

  it('refuses an invalid base branch before making anything', async () => {
    const dir = path.join(fx.root, 'bad-branch');
    await expect(
      createRepository(git, dir, { ...options, baseBranch: 'no..dots' }),
    ).rejects.toThrow(/isn't a valid branch name/);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('removes what it made when git has no identity, and says how to set one', async () => {
    const env: Record<string, string> = { ...fx.env };
    for (const key of Object.keys(env))
      if (key.startsWith('GIT_AUTHOR') || key.startsWith('GIT_COMMITTER')) delete env[key];
    env.EMAIL = '';
    env.GIT_CONFIG_GLOBAL = path.join(fx.root, 'no-identity.gitconfig');
    fs.writeFileSync(env.GIT_CONFIG_GLOBAL, '[user]\n\tuseConfigOnly = true\n');
    const anonymous = new Git({ gitPath: 'git', env });
    const fresh = path.join(fx.root, 'no-identity');
    await expect(createRepository(anonymous, fresh, options)).rejects.toThrow(/commit identity/);
    expect(fs.existsSync(fresh)).toBe(false);
    const existing = path.join(fx.root, 'no-identity-existing');
    fs.mkdirSync(existing);
    await expect(createRepository(anonymous, existing, options)).rejects.toThrow(/commit identity/);
    expect(fs.readdirSync(existing)).toEqual([]);
  });
});
