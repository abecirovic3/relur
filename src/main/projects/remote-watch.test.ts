import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigStore } from '../config/store';
import { EnvService } from '../env/service';
import { ProjectService } from '../services/projects';
import { createFixture, type Fixture } from '../test-support/git-fixtures';
import { SEED_CONFIG } from '../test-support/seed-config';
import { type RemoteFound, RemoteWatch } from './remote-watch';

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

const until = async (done: () => boolean) => {
  for (let i = 0; i < 60 && !done(); i++) await new Promise((r) => setTimeout(r, 50));
};

describe('RemoteWatch (spec §6.10)', () => {
  it('notices `git remote add origin` in a project without a remote, once', async () => {
    const repo = fx.localRepo('watched');
    const project = await projects.add({
      profileId: 'work',
      repoPath: repo,
      name: 'watched',
      remote: null,
      baseBranch: 'main',
    });
    const watch = new RemoteWatch(config, projects, 20);
    const found: RemoteFound[] = [];
    watch.onFound((f) => found.push(f));
    watch.start();
    try {
      // The remotes it starts with are read first.
      await new Promise((r) => setTimeout(r, 100));
      fx.git(repo, 'remote', 'add', 'origin', repo);
      await until(() => found.length > 0);
      expect(found).toEqual([{ projectId: project.id, projectName: 'watched', remote: 'origin' }]);
      expect(config.require().projects.find((p) => p.id === project.id)?.remote).toBe('origin');
      // It has a remote now: focus checks leave it alone.
      watch.focused();
      await new Promise((r) => setTimeout(r, 200));
      expect(found).toHaveLength(1);
    } finally {
      watch.dispose();
    }
  });

  it('finds it on focus too', async () => {
    const repo = fx.localRepo('focused');
    const project = await projects.add({
      profileId: 'work',
      repoPath: repo,
      name: 'focused',
      remote: null,
      baseBranch: 'main',
    });
    const watch = new RemoteWatch(config, projects, 60_000);
    const found: RemoteFound[] = [];
    watch.onFound((f) => found.push(f));
    watch.start();
    try {
      await new Promise((r) => setTimeout(r, 100));
      // The folder watch waits a minute here: focus finds it first.
      fx.git(repo, 'remote', 'add', 'origin', repo);
      watch.focused();
      await until(() => found.length > 0);
      expect(found.map((f) => f.projectId)).toEqual([project.id]);
    } finally {
      watch.dispose();
    }
  });

  it('leaves alone a project set to no remote while it has an origin', async () => {
    const { clone } = fx.cloneWithRemote('chose-none');
    const project = await projects.addClone('work', clone, null);
    await projects.setRemote(project.id, null);
    const watch = new RemoteWatch(config, projects, 20);
    const found: RemoteFound[] = [];
    watch.onFound((f) => found.push(f));
    watch.start();
    try {
      await new Promise((r) => setTimeout(r, 100));
      watch.focused();
      fx.git(clone, 'remote', 'add', 'upstream', clone);
      await new Promise((r) => setTimeout(r, 300));
      expect(found).toEqual([]);
      expect(config.require().projects.find((p) => p.id === project.id)?.remote).toBeNull();
    } finally {
      watch.dispose();
    }
  });
});
