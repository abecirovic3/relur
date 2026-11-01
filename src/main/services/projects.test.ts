import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigStore } from '../config/store';
import { EnvService } from '../env/service';
import { createFixture, type Fixture } from '../test-support/git-fixtures';
import { SEED_CONFIG } from '../test-support/seed-config';
import { ProjectService } from './projects';

let fx: Fixture;
let config: ConfigStore;
let projects: ProjectService;

beforeAll(() => {
  fx = createFixture();
  const file = path.join(fx.root, 'config', 'config.json');
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(SEED_CONFIG));
  config = new ConfigStore(file);
  config.load();
  const env = new EnvService(
    config,
    Promise.resolve({ env: fx.env, shell: '/bin/sh', source: 'login-shell' }),
  );
  projects = new ProjectService(config, env);
});
afterAll(() => fx.cleanup());

describe('ProjectService', () => {
  it('detects the main checkout, origin and its default branch', async () => {
    const { clone } = fx.cloneWithRemote('api-service', 'develop');
    fs.mkdirSync(path.join(clone, 'src'));
    const candidate = await projects.inspect(path.join(clone, 'src'), 'work');
    expect(candidate).toMatchObject({
      repoPath: clone,
      name: 'api-service',
      remotes: ['origin'],
      remote: 'origin',
      baseBranch: 'develop',
      baseBranchSource: 'remote-head',
      conflict: null,
    });
  });

  it('refuses relative paths and folders that do not exist', async () => {
    await expect(projects.inspect('code/repo', 'work')).rejects.toThrow(/absolute path/);
    await expect(projects.inspect(path.join(fx.root, 'missing'), 'work')).rejects.toThrow(
      /There is no folder at/,
    );
  });

  it('uses the current branch for a repository without remotes', async () => {
    const repo = fx.localRepo('local-only', 'trunk');
    const candidate = await projects.inspect(repo, 'personal');
    expect(candidate).toMatchObject({
      remote: null,
      baseBranch: 'trunk',
      baseBranchSource: 'current-branch',
    });
  });

  it('falls back to the profile default when the remote HEAD is unknown', async () => {
    const repo = fx.localRepo('no-remote-head');
    fx.git(repo, 'remote', 'add', 'origin', 'https://example.invalid/r.git');
    const candidate = await projects.inspect(repo, 'work');
    expect(candidate).toMatchObject({ baseBranch: 'main', baseBranchSource: 'profile-default' });
  });

  it('adds a project to config.json and refuses it in another profile (R1)', async () => {
    const { clone } = fx.cloneWithRemote('web-app');
    const project = await projects.add({
      profileId: 'work',
      repoPath: clone,
      name: 'web-app',
      remote: 'origin',
      baseBranch: 'main',
    });
    expect(project).toMatchObject({ id: 'web-app', profileId: 'work', repoPath: clone });
    expect(config.get().config?.projects.map((p) => p.id)).toContain('web-app');

    const again = await projects.inspect(clone, 'personal');
    expect(again.conflict).toEqual({
      projectId: 'web-app',
      profileId: 'work',
      profileName: 'Work',
    });
    await expect(
      projects.add({
        profileId: 'personal',
        repoPath: clone,
        name: 'web-app',
        remote: 'origin',
        baseBranch: 'main',
      }),
    ).rejects.toThrow(/already registered under the Work profile/);
  });

  it('gives a project a unique id and rejects an unknown remote', async () => {
    const first = fx.localRepo('dup/web-app');
    const added = await projects.add({
      profileId: 'personal',
      repoPath: first,
      name: 'Web App',
      remote: null,
      baseBranch: 'main',
    });
    expect(added.id).toBe('web-app-2');

    const second = fx.localRepo('other');
    await expect(
      projects.add({
        profileId: 'personal',
        repoPath: second,
        name: 'other',
        remote: 'origin',
        baseBranch: 'main',
      }),
    ).rejects.toThrow(/no remote named "origin"/);
  });
});

describe('ProjectService.remove', () => {
  it("stores a project's own worktree folder, refusing one inside the main checkout", async () => {
    const repo = fx.localRepo('trees');
    fs.mkdirSync(path.join(repo, 'inside'));
    const outside = path.join(fx.root, 'trees-elsewhere');
    fs.mkdirSync(outside);
    const add = (worktreeRoot: string | null) =>
      projects.add({
        profileId: 'work',
        repoPath: repo,
        name: 'trees',
        remote: null,
        baseBranch: 'main',
        worktreeRoot,
      });
    await expect(add(path.join(repo, 'inside'))).rejects.toThrow(/inside the repository/);
    await expect(add(repo)).rejects.toThrow(/inside the repository/);
    await expect(add(path.join(fx.root, 'missing'))).rejects.toThrow(/is not a folder/);
    const project = await add(outside);
    expect(project.worktreeRoot).toBe(outside);
    // The repository's own parent is fine: its .worktrees folder is outside the checkout.
    expect(projects.setWorktreeRoot(project.id, path.dirname(repo)).worktreeRoot).toBe(
      path.dirname(repo),
    );

    expect(projects.setWorktreeRoot(project.id, null).worktreeRoot).toBeUndefined();
    const raw = () => JSON.parse(fs.readFileSync(config.file, 'utf8')).projects;
    expect(raw().find((p: { id: string }) => p.id === project.id)).not.toHaveProperty(
      'worktreeRoot',
    );
    expect(() => projects.setWorktreeRoot(project.id, path.join(repo, 'inside'))).toThrow(
      /inside the repository/,
    );
    expect(projects.setWorktreeRoot(project.id, outside).worktreeRoot).toBe(outside);
  });

  it('removes the project from config.json and leaves the repository alone', async () => {
    const repo = fx.localRepo('to-remove');
    const project = await projects.add({
      profileId: 'work',
      repoPath: repo,
      name: 'to-remove',
      remote: null,
      baseBranch: 'main',
    });
    projects.remove(project.id);
    expect(config.require().projects.some((p) => p.id === project.id)).toBe(false);
    expect(fs.existsSync(path.join(repo, 'README'))).toBe(true);
    expect(() => projects.remove(project.id)).toThrow(/Unknown project/);
  });
});

describe('adding a folder of repositories (spec §6.1, §7.5)', () => {
  let folder: string;
  beforeAll(() => {
    folder = path.join(fx.root, 'many');
    for (const name of ['one', 'two', 'three']) fx.localRepo(path.join('many', name));
  });

  it('examines a repository as one project and a folder as its repositories', async () => {
    const one = await projects.examine(path.join(folder, 'one'), 'personal');
    expect(one.kind).toBe('repository');
    const many = await projects.examine(folder, 'personal');
    expect(many).toMatchObject({
      kind: 'folder',
      repositories: ['one', 'three', 'two'].map((n) => path.join(folder, n)),
    });
    fs.mkdirSync(path.join(fx.root, 'empty-folder'));
    await expect(projects.examine(path.join(fx.root, 'empty-folder'), 'personal')).rejects.toThrow(
      /none of the folders in it are/,
    );
  });

  it('adds several at once; one refusal does not stop the others', async () => {
    const item = (name: string) => ({
      repoPath: path.join(folder, name),
      name: `many-${name}`,
      remote: null,
      baseBranch: 'main',
    });
    const results = await projects.addMany(
      'personal',
      [item('one'), { ...item('two'), repoPath: path.join(fx.root, 'missing') }, item('three')],
      null,
    );
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    expect(results[1]).toMatchObject({ ok: false, error: expect.stringMatching(/no folder/) });
  });

  it('`add <folder> --all` adds the rest, skips ones already added, refuses another profile', async () => {
    const cli = (path: string, profileId: string, all: boolean) =>
      projects.addFromCli({
        path,
        profileId,
        name: null,
        base: null,
        terminalProfileId: null,
        all,
      });
    const refused = await cli(folder, 'personal', false);
    expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/--all$/) });
    const result = await cli(folder, 'personal', true);
    expect(result.ok && 'results' in result ? result.results : null).toEqual([
      { repoPath: expect.stringMatching(/one$/), status: 'already-added' },
      { repoPath: expect.stringMatching(/three$/), status: 'already-added' },
      {
        repoPath: expect.stringMatching(/two$/),
        status: 'added',
        project: expect.objectContaining({ id: 'two', profileId: 'personal' }),
      },
    ]);
    const other = await cli(folder, 'work', true);
    expect(other.ok && 'results' in other ? other.results.map((r) => r.status) : null).toEqual([
      'refused',
      'refused',
      'refused',
    ]);
    expect(other.ok && 'results' in other ? other.results[0]?.error : null).toMatch(
      /Personal profile/,
    );
  });
});
