import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NO_EDITOR } from '@shared/editor';
import type { Workspace } from '@shared/workspaces';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigStore } from '../config/store';
import { SEED_CONFIG } from '../test-support/seed-config';
import { EditorService, findInstall } from './service';

let root: string;
let bin: string;
let config: ConfigStore;
let service: EditorService;

/** A fake editor command that records its arguments, one per line, then exits with `code`. */
const fakeEditor = (name: string, code = 0, stderr = '') => {
  const file = path.join(bin, name);
  fs.writeFileSync(
    file,
    `#!/bin/sh\nprintf '%s\\n' "$@" >> "${root}/${name}.log"\n${stderr ? `echo '${stderr}' >&2\n` : ''}exit ${code}\n`,
    { mode: 0o755 },
  );
};
const calls = (name: string) => {
  const file = path.join(root, `${name}.log`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trimEnd().split('\n') : [];
};

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'editor-')));
  bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const file = path.join(root, 'config.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      ...SEED_CONFIG,
      projects: [
        { id: 'api', profileId: 'work', name: 'api', repoPath: path.join(root, 'api') },
        { id: 'web', profileId: 'work', name: 'web', repoPath: path.join(root, 'web') },
        { id: 'lib', profileId: 'work', name: 'lib', repoPath: path.join(root, 'lib') },
      ],
    }),
  );
  config = new ConfigStore(file);
  config.load();
  const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: root };
  service = new EditorService(
    config,
    async () => ({ env, shell: '/bin/sh' }),
    path.join(root, 'data'),
  );
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('EditorService', () => {
  it('finds editors on PATH, in JetBrains Toolbox and as macOS apps', () => {
    fakeEditor('code');
    const env = { PATH: bin };
    expect(findInstall('vscode', env, root)).toEqual({
      how: 'command',
      path: path.join(bin, 'code'),
    });
    expect(findInstall('idea', env, root, 'linux')).toBeNull();
    const toolbox = path.join(root, '.local', 'share', 'JetBrains', 'Toolbox', 'scripts');
    if (process.platform !== 'darwin') {
      fs.mkdirSync(toolbox, { recursive: true });
      fs.writeFileSync(path.join(toolbox, 'idea'), '#!/bin/sh\n', { mode: 0o755 });
      expect(findInstall('idea', env, root)).toEqual({
        how: 'command',
        path: path.join(toolbox, 'idea'),
      });
    } else {
      fs.mkdirSync(path.join(root, 'Applications', 'Zed.app'), { recursive: true });
      expect(findInstall('zed', env, root)).toEqual({
        how: 'app',
        path: path.join(root, 'Applications', 'Zed.app'),
      });
    }
  });

  it('finds snap, flatpak and package names on Linux, also off PATH', () => {
    const exe = (dir: string, name: string) => {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name), '#!/bin/sh\n', { mode: 0o755 });
      return path.join(dir, name);
    };
    const env = { PATH: bin };
    // A flatpak export in the user's installation, which zsh's PATH lacks.
    const flatpak = exe(
      path.join(root, '.local', 'share', 'flatpak', 'exports', 'bin'),
      'com.jetbrains.WebStorm',
    );
    expect(findInstall('webstorm', env, root, 'linux')).toEqual({ how: 'command', path: flatpak });
    expect(findInstall('webstorm', env, root, 'darwin')).toBeNull();
    // A package name on PATH (Arch calls Zed zeditor), and the snap name of IDEA.
    const zeditor = exe(bin, 'zeditor');
    expect(findInstall('zed', env, root, 'linux')).toEqual({ how: 'command', path: zeditor });
    const snap = exe(bin, 'intellij-idea-community');
    expect(findInstall('idea', env, root, 'linux')).toEqual({ how: 'command', path: snap });
    // The usual command comes first.
    const zed = exe(path.join(root, '.local', 'bin'), 'zed');
    expect(findInstall('zed', { PATH: '' }, root, 'linux')).toEqual({ how: 'command', path: zed });
  });

  it("opens with the project's editor, else the profile's, else asks for one", async () => {
    fakeEditor('code');
    fakeEditor('idea');
    await expect(service.open('work', 'api', { kind: 'folder', path: '/w/api' })).rejects.toThrow(
      NO_EDITOR,
    );
    service.setProfileEditor('work', { kind: 'vscode' });
    service.setProjectEditor('api', { kind: 'idea' });
    await service.open('work', 'api', { kind: 'file', file: '/w/api/a.ts', line: 7 });
    await service.open('work', 'web', { kind: 'file', file: '/w/web/b.ts', line: 3 });
    expect(calls('idea')).toEqual(['--line', '7', '/w/api/a.ts']);
    expect(calls('code')).toEqual(['-g', '/w/web/b.ts:3']);
    // Saved in config.json only; null goes back to the profile's.
    expect(config.require().projects.find((p) => p.id === 'api')?.editor).toEqual({ kind: 'idea' });
    service.setProjectEditor('api', null);
    expect(config.require().projects.find((p) => p.id === 'api')?.editor).toBeUndefined();
  });

  it('runs a custom command through the shell, its folder command for a file without one', async () => {
    fakeEditor('myedit');
    service.setProfileEditor('work', { kind: 'custom', folder: 'myedit --dir {path}' });
    await service.open('work', null, { kind: 'file', file: '/w/my repo/src/x.ts', line: 9 });
    expect(calls('myedit')).toEqual(['--dir', '/w/my repo/src']);
  });

  it('says plainly when the editor is missing or fails, with the command and the setting', async () => {
    service.setProfileEditor('work', { kind: 'zed' });
    await expect(service.open('work', 'web', { kind: 'folder', path: '/w' })).rejects.toThrow(
      "Couldn't open Zed: its command `zed` wasn't found. Choose another editor in Edit profile › General › Editor.",
    );
    fakeEditor('broken', 2, 'no such window');
    service.setProjectEditor('web', { kind: 'custom', folder: 'broken {path}' });
    await expect(service.open('work', 'web', { kind: 'folder', path: '/w' })).rejects.toThrow(
      "Couldn't open Custom command: `broken /w` exited with 2 (no such window). Check the editor in web's Setup tab › Editor.",
    );
    service.setProjectEditor('web', { kind: 'custom', folder: 'nothere {path}' });
    await expect(service.open('work', 'web', { kind: 'folder', path: '/w' })).rejects.toThrow(
      '`nothere /w` was not found',
    );
  });

  it('opens all: VS Code folders in one window from a .code-workspace file, others one each', async () => {
    fakeEditor('code');
    fakeEditor('idea');
    service.setProfileEditor('work', { kind: 'vscode' });
    service.setProjectEditor('lib', { kind: 'idea' });
    const workspace = { id: 'ws_1', profileId: 'work' } as Workspace;
    await service.openAll(workspace, [
      { projectId: 'api', worktreePath: '/w/api/feat', name: 'api' },
      { projectId: 'web', worktreePath: '/w/web/feat', name: 'web' },
      { projectId: 'lib', worktreePath: '/w/lib/feat', name: 'lib' },
    ]);
    const file = path.join(root, 'data', 'editor-workspaces', 'ws_1-vscode.code-workspace');
    expect(calls('code')).toEqual([file]);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).folders).toEqual([
      { name: 'api', path: '/w/api/feat' },
      { name: 'web', path: '/w/web/feat' },
    ]);
    expect(calls('idea')).toEqual(['/w/lib/feat']);
    service.forget('ws_1');
    expect(fs.existsSync(file)).toBe(false);
  });
});
