import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type ConfigInput, WorkflowSchema } from '@shared/schemas';
import { sourceApplies } from '@shared/skills';
import { WORKFLOW_FILE, workflowFileText } from '@shared/workflow-file';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigStore } from '../config/store';
import { EnvService } from '../env/service';
import { frontMatter } from '../frontmatter';
import { sessionProjects } from '../services/terminals';
import { createFixture, type Fixture } from '../test-support/git-fixtures';
import { defaultSourceName, gitSourceProblem, SkillService } from './service';
import { detectSource, ensureWrapper, readSkill, wrapperName } from './sources';
import { readWorkflowFile } from './workflow-file';

let fx: Fixture;
beforeEach(() => {
  fx = createFixture();
});
afterEach(() => fx.cleanup());

const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const skill = (dir: string, name: string, description = `About ${name}.`) =>
  write(
    path.join(dir, name, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\nBody\n`,
  );
const plugin = (dir: string, name: string, skills: string[] = []) => {
  write(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name }));
  for (const s of skills) skill(path.join(dir, 'skills'), s);
  return dir;
};

describe('frontMatter and readSkill', () => {
  it('reads the leading YAML block, multi-line values included', () => {
    expect(frontMatter('---\nname: a\ndescription: >\n  one\n  two\n---\n# T\n')).toEqual({
      name: 'a',
      description: 'one two\n',
    });
    expect(frontMatter('# No front matter\n')).toBeNull();
    expect(frontMatter('---\n---\n')).toEqual({});
    expect(() => frontMatter('---\n- a\n---\n')).toThrow(/not a list of fields/);
  });

  it('falls back to top-level key: value lines when strict YAML fails', () => {
    // ": " in a plain value is a YAML error; Claude Code reads it anyway.
    expect(
      frontMatter(
        '---\nname: plan\ndescription: Use when: the task needs a plan\nmetadata:\n  a: b\n---\n',
      ),
    ).toEqual({ name: 'plan', description: 'Use when: the task needs a plan', metadata: null });
    expect(
      frontMatter('\ufeff---\r\nstatus: "spec-review"\r\ntitle: Fix: login\r\n---\r\n'),
    ).toEqual({ status: 'spec-review', title: 'Fix: login' });
    expect(() => frontMatter('---\n{ unclosed\n---\n')).toThrow();
  });

  it('falls back to the folder name and reports unreadable files', () => {
    const dir = path.join(fx.root, 's');
    write(path.join(dir, 'plain', 'SKILL.md'), '---\ndescription: Only a description\n---\n');
    write(path.join(dir, 'bare', 'SKILL.md'), 'No front matter\n');
    write(path.join(dir, 'broken', 'SKILL.md'), '---\n[unclosed\n---\n');
    expect(readSkill(path.join(dir, 'plain'))).toEqual({
      name: 'plain',
      description: 'Only a description',
      error: null,
    });
    expect(readSkill(path.join(dir, 'bare')).error).toBe('SKILL.md has no front matter');
    expect(readSkill(path.join(dir, 'broken')).error).toMatch(/can't be read/);
  });
});

describe('detectSource', () => {
  it('finds a plugin, also when it is its own marketplace', () => {
    const dir = plugin(path.join(fx.root, 'p'), 'team-tools', ['a']);
    write(
      path.join(dir, '.claude-plugin', 'marketplace.json'),
      '{"plugins":[{"name":"team-tools","source":"./"}]}',
    );
    expect(detectSource(dir)).toEqual({
      shape: 'plugin',
      plugins: [{ name: 'team-tools', dir }],
      skillsDir: null,
      error: null,
    });
  });

  it('finds the plugins a marketplace lists by relative path, and child plugins', () => {
    const market = path.join(fx.root, 'market');
    plugin(path.join(market, 'plugins', 'one'), 'one');
    fs.mkdirSync(path.join(market, 'plugins', 'two'), { recursive: true });
    write(
      path.join(market, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({
        plugins: [
          { name: 'one', source: './plugins/one' },
          { name: 'two', source: './plugins/two' },
          { name: 'far', source: '../elsewhere' },
          { name: 'remote', source: { source: 'github', repo: 'x/y' } },
        ],
      }),
    );
    expect(detectSource(market).plugins.map((p) => p.name)).toEqual(['one', 'two']);

    const folder = path.join(fx.root, 'folder');
    plugin(path.join(folder, 'b'), 'bee');
    plugin(path.join(folder, 'a'), 'ay');
    fs.mkdirSync(path.join(folder, 'not-a-plugin'));
    const found = detectSource(folder);
    expect(found.shape).toBe('plugins');
    expect(found.plugins.map((p) => p.name)).toEqual(['ay', 'bee']);
  });

  it('finds plain skill folders in the folder or its skills/, else nothing', () => {
    const top = path.join(fx.root, 'top');
    skill(top, 'one');
    expect(detectSource(top)).toMatchObject({ shape: 'skills', skillsDir: top });
    const nested = path.join(fx.root, 'nested');
    skill(path.join(nested, 'skills'), 'two');
    expect(detectSource(nested)).toMatchObject({
      shape: 'skills',
      skillsDir: path.join(nested, 'skills'),
    });
    const empty = path.join(fx.root, 'empty');
    fs.mkdirSync(empty);
    expect(detectSource(empty)).toMatchObject({
      shape: 'none',
      error: 'No plugin or skills found',
    });
    expect(detectSource(path.join(fx.root, 'missing')).error).toMatch(/doesn't exist/);
  });
});

describe('ensureWrapper', () => {
  it('writes a manifest named after the source and links skills/ to the folder', () => {
    const skills = path.join(fx.root, 'my skills');
    skill(skills, 'one');
    const root = path.join(fx.root, 'plugins');
    const dir = ensureWrapper(root, 'work', { id: 'mine', name: 'My Skills' }, skills);
    expect(dir).toBe(path.join(root, 'work', 'mine'));
    expect(
      JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), 'utf8')).name,
    ).toBe('my-skills');
    expect(fs.readlinkSync(path.join(dir, 'skills'))).toBe(skills);
    expect(fs.existsSync(path.join(dir, 'skills', 'one', 'SKILL.md'))).toBe(true);

    const other = path.join(fx.root, 'other');
    skill(other, 'two');
    ensureWrapper(root, 'work', { id: 'mine', name: 'Renamed' }, other);
    expect(fs.readlinkSync(path.join(dir, 'skills'))).toBe(other);
    expect(wrapperName({ id: 'x', name: '!!' })).toBe('x');
  });
});

describe('sourceApplies and sessionProjects', () => {
  it('applies to all projects or the selected ones, unless switched off', () => {
    const project = { id: 'api', skillsOff: [] as string[] };
    expect(sourceApplies({ id: 's', projects: null }, project)).toBe(true);
    expect(sourceApplies({ id: 's', projects: ['web'] }, project)).toBe(false);
    expect(sourceApplies({ id: 's', projects: ['api'] }, project)).toBe(true);
    expect(sourceApplies({ id: 's', projects: null }, { id: 'api', skillsOff: ['s'] })).toBe(false);
  });

  it('gives a workspace all of its repositories, a project itself, home null', () => {
    const repo = (projectId: string) => ({ projectId }) as never;
    expect(sessionProjects({ id: 'api' }, { repos: [repo('api'), repo('web')] })).toEqual([
      'api',
      'web',
    ]);
    expect(sessionProjects({ id: 'api' }, undefined)).toEqual(['api']);
    expect(sessionProjects(undefined, undefined)).toBeNull();
  });
});

describe('SkillService', () => {
  let config: ConfigStore;
  let service: SkillService;
  let dataDir: string;

  const seed = (extra: Partial<ConfigInput> = {}) => {
    const file = path.join(dataDir, 'config.json');
    write(
      file,
      JSON.stringify({
        version: 1,
        profiles: [{ id: 'work', name: 'Work' }],
        projects: [
          { id: 'api', profileId: 'work', name: 'api', repoPath: path.join(fx.root, 'api') },
          { id: 'web', profileId: 'work', name: 'web', repoPath: path.join(fx.root, 'web') },
        ],
        ...extra,
      }),
    );
    config = new ConfigStore(file);
    config.load();
    const env = new EnvService(
      config,
      Promise.resolve({ env: fx.env, shell: '/bin/sh', source: 'login-shell' }),
    );
    service = new SkillService(config, env, dataDir);
  };
  const raw = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));

  beforeEach(() => {
    dataDir = path.join(fx.root, 'data');
    seed();
  });

  it('adds a local folder for all projects and loads it everywhere', async () => {
    const folder = plugin(path.join(fx.root, 'tools'), 'tools', ['review']);
    const source = await service.add('work', {
      name: '',
      kind: 'folder',
      location: folder,
      projects: null,
    });
    expect(source).toMatchObject({ id: 'tools', name: 'tools', kind: 'folder', projects: null });
    expect(raw().profiles[0].skills).toEqual([
      { id: 'tools', name: 'tools', kind: 'folder', path: folder },
    ]);
    expect((await service.pluginDirs('work', ['api'])).dirs).toEqual([folder]);
    expect((await service.pluginDirs('work', null)).dirs).toEqual([folder]);
    const [inspection] = await service.inspectAll('work');
    expect(inspection).toMatchObject({ shape: 'plugin', error: null, commit: null });
    expect(inspection?.plugins[0]?.skills).toEqual([
      { name: 'review', description: 'About review.', error: null },
    ]);
    await expect(
      service.add('work', {
        name: 'x',
        kind: 'folder',
        location: path.join(fx.root, 'nope'),
        projects: null,
      }),
    ).rejects.toThrow(/doesn't exist/);
  });

  it('wraps a plain folder, applies selected sources only there, and the switch edits the right list', async () => {
    const plain = path.join(fx.root, 'plain');
    skill(plain, 'hello');
    const source = await service.add('work', {
      name: 'My skills',
      kind: 'folder',
      location: plain,
      projects: ['api', 'unknown'],
    });
    expect(source.projects).toEqual(['api']);
    const wrapper = path.join(dataDir, 'plugins', 'work', 'my-skills');
    expect((await service.pluginDirs('work', ['api'])).dirs).toEqual([wrapper]);
    expect((await service.pluginDirs('work', ['web'])).dirs).toEqual([]);
    expect((await service.pluginDirs('work', ['web', 'api'])).dirs).toEqual([wrapper]);
    expect((await service.pluginDirs('work', null)).dirs).toEqual([]);

    service.setEnabled('web', 'my-skills', true);
    expect(raw().profiles[0].skills[0].projects).toEqual(['api', 'web']);
    service.setEnabled('api', 'my-skills', false);
    expect(raw().profiles[0].skills[0].projects).toEqual(['web']);

    service.edit('work', 'my-skills', { name: 'My skills', projects: null });
    service.setEnabled('api', 'my-skills', false);
    expect(raw().projects[0].skillsOff).toEqual(['my-skills']);
    expect(service.forProject('api')).toMatchObject([{ enabled: false }]);
    expect((await service.pluginDirs('work', ['api'])).dirs).toEqual([]);
    service.setEnabled('api', 'my-skills', true);
    expect(raw().projects[0].skillsOff).toBeUndefined();
  });

  it('clones a git source, updates it fast-forward and reports a diverged clone', async () => {
    const { origin, clone: upstream } = fx.cloneWithRemote('team-skills');
    plugin(upstream, 'team', ['one']);
    fx.git(upstream, 'add', '.');
    fx.git(upstream, 'commit', '-q', '-m', 'Add the plugin');
    fx.git(upstream, 'push', '-q', 'origin', 'main');

    await service.add('work', { name: 'Team', kind: 'git', location: origin, projects: null });
    const dir = path.join(dataDir, 'skill-sources', 'work', 'team');
    expect(fs.existsSync(path.join(dir, '.claude-plugin', 'plugin.json'))).toBe(true);
    const first = await service.pluginDirs('work', ['api']);
    expect(first.dirs).toEqual([dir]);
    const [before] = await service.inspectAll('work');
    expect(before?.commit?.subject).toBe('Add the plugin');
    expect(before?.workflow).toBeNull();

    expect(await service.update('work', 'team')).toMatchObject({
      ok: true,
      message: 'Already up to date',
      moved: false,
    });
    skill(path.join(upstream, 'skills'), 'two');
    // A workflow file at the root comes with the update (spec §13.9).
    fs.writeFileSync(
      path.join(upstream, WORKFLOW_FILE),
      workflowFileText(
        WorkflowSchema.parse({ file: 'spec.md', statuses: [{ value: 'a', label: 'A' }] }),
      ),
    );
    fx.git(upstream, 'add', '.');
    fx.git(upstream, 'commit', '-q', '-m', 'Add two');
    fx.git(upstream, 'push', '-q', 'origin', 'main');
    const updated = await service.update('work', 'team');
    expect(updated).toMatchObject({ ok: true, commit: { subject: 'Add two' }, moved: true });
    expect((await service.inspect('work', 'team')).workflow).toMatchObject({
      ok: true,
      workflow: { file: 'spec.md', statuses: [{ value: 'a', label: 'A', kind: 'step' }] },
    });
    expect(updated.message).toMatch(/^Updated to \w+ Add two$/);
    expect((await service.pluginDirs('work', ['api'])).fingerprint).not.toBe(first.fingerprint);

    fx.git(dir, 'commit', '-q', '--allow-empty', '-m', 'local');
    fx.git(upstream, 'commit', '-q', '--allow-empty', '-m', 'remote');
    fx.git(upstream, 'push', '-q', 'origin', 'main');
    const diverged = await service.update('work', 'team');
    expect(diverged.ok).toBe(false);
    expect(diverged.message).toMatch(/can't be fast-forwarded/);
  });

  it('saves nothing when the clone fails, and removes a clone only when asked', async () => {
    await expect(
      service.add('work', {
        name: 'Bad',
        kind: 'git',
        location: path.join(fx.root, 'none.git'),
        projects: null,
      }),
    ).rejects.toThrow();
    expect(raw().profiles[0].skills).toBeUndefined();
    expect(fs.existsSync(path.join(dataDir, 'skill-sources', 'work', 'bad'))).toBe(false);

    const { origin } = fx.cloneWithRemote('s');
    await service.add('work', { name: 'Kept', kind: 'git', location: origin, projects: null });
    await service.add('work', { name: 'Gone', kind: 'git', location: origin, projects: null });
    service.setEnabled('api', 'kept', false);
    service.remove('work', 'kept', { deleteClone: false });
    service.remove('work', 'gone', { deleteClone: true });
    expect(raw().profiles[0].skills).toBeUndefined();
    expect(raw().projects[0].skillsOff).toBeUndefined();
    expect(fs.existsSync(path.join(dataDir, 'skill-sources', 'work', 'kept'))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, 'skill-sources', 'work', 'gone'))).toBe(false);
  });

  it('tells which running Claudes started with other skills', async () => {
    const folder = plugin(path.join(fx.root, 'tools'), 'tools');
    const running = [{ workspaceId: 'ws1', profileId: 'work', projectIds: ['api'] }];
    service.claudeStarted('ws1', (await service.pluginDirs('work', ['api'])).fingerprint);
    expect(await service.changedWorkspaces(running)).toEqual([]);
    await service.add('work', { name: 'tools', kind: 'folder', location: folder, projects: null });
    expect(await service.changedWorkspaces(running)).toEqual(['ws1']);
    service.claudeStopped('ws1');
    expect(await service.changedWorkspaces(running)).toEqual([]);
  });

  it('names sources from their location and explains sign-in failures', () => {
    expect(defaultSourceName('git@git.example.com:team/skills.git')).toBe('skills');
    expect(defaultSourceName('~/code/my-skills/')).toBe('my-skills');
    expect(gitSourceProblem('u', 'fatal: could not read Username')).toMatch(
      /couldn't sign in to u/,
    );
  });
});

describe('readWorkflowFile', () => {
  it('reads the file at the root, says why one is unusable, and is null without one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-file-'));
    try {
      expect(readWorkflowFile(dir)).toBeNull();
      fs.writeFileSync(path.join(dir, WORKFLOW_FILE), '{"kind":"other"}');
      expect(readWorkflowFile(dir)).toMatchObject({ ok: false });
      fs.writeFileSync(
        path.join(dir, WORKFLOW_FILE),
        workflowFileText(WorkflowSchema.parse({ file: 'spec.md' })),
      );
      expect(readWorkflowFile(dir)).toMatchObject({ ok: true, workflow: { file: 'spec.md' } });
      fs.rmSync(path.join(dir, WORKFLOW_FILE));
      fs.mkdirSync(path.join(dir, WORKFLOW_FILE));
      expect(readWorkflowFile(dir)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
