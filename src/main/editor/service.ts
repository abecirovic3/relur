import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  type EditorInstall,
  type EditorTarget,
  editorFor,
  editorInvocation,
  editorLabel,
  editorWindows,
  type Invocation,
  invocationText,
  isMultiRoot,
  KNOWN_EDITORS,
  NO_EDITOR,
} from '@shared/editor';
import {
  EDITOR_KINDS,
  type Editor,
  type EditorKind,
  type Profile,
  type Project,
} from '@shared/schemas';
import type { Workspace } from '@shared/workspaces';
import type { ConfigStore } from '../config/store';
import { resolveExecutable } from '../env/which';
import { expandHome } from '../paths';

/** Where and how editors start: the profile's environment and shell. */
export interface EditorContext {
  shell: string;
  env: Record<string, string>;
}

/** An editor found on this machine, for the settings. */
export interface FoundEditor {
  kind: EditorKind;
  label: string;
  install: EditorInstall;
}

/** How long an editor's command may take to fail before it counts as started. */
const SETTLE_MS = 3000;

/** JetBrains Toolbox's folder of command line tools. */
function toolboxScripts(home: string, platform: NodeJS.Platform): string {
  return platform === 'darwin'
    ? path.join(home, 'Library', 'Application Support', 'JetBrains', 'Toolbox', 'scripts')
    : path.join(home, '.local', 'share', 'JetBrains', 'Toolbox', 'scripts');
}

/**
 * Linux folders of command line tools that are often missing from PATH:
 * zsh and fish logins don't read /etc/profile.d, where snap and flatpak add
 * theirs, and desktops don't always add ~/.local/bin (Zed's installer).
 */
export function linuxCommandDirs(home: string): string[] {
  return [
    '/snap/bin',
    '/var/lib/flatpak/exports/bin',
    path.join(home, '.local', 'share', 'flatpak', 'exports', 'bin'),
    path.join(home, '.local', 'bin'),
  ];
}

/**
 * Where a known editor is installed: its command line tool on the profile's
 * PATH, in JetBrains Toolbox's scripts folder, (Linux) under its snap,
 * flatpak or package name on PATH or in snap's and flatpak's folders, or
 * (macOS) its app.
 */
export function findInstall(
  kind: EditorKind,
  env: Record<string, string>,
  home: string,
  platform = process.platform,
): EditorInstall | null {
  const known = KNOWN_EDITORS[kind];
  const command = resolveExecutable(known.command, env, home);
  if (command) return { how: 'command', path: command };
  if (known.toolbox) {
    const scripts = toolboxScripts(home, platform);
    const script = resolveExecutable(path.join(scripts, known.command), env, home);
    if (script) return { how: 'command', path: script };
  }
  if (platform === 'linux') {
    const names = [known.command, ...known.linux];
    const extra = { PATH: linuxCommandDirs(home).join(path.delimiter) };
    for (const where of [env, extra]) {
      for (const name of names) {
        const found = resolveExecutable(name, where, home);
        if (found) return { how: 'command', path: found };
      }
    }
  }
  if (platform === 'darwin') {
    for (const dir of ['/Applications', path.join(home, 'Applications')]) {
      for (const app of known.apps) {
        const bundle = path.join(dir, app);
        if (fs.existsSync(bundle)) return { how: 'app', path: bundle };
      }
    }
  }
  return null;
}

/**
 * Open in editor (spec §6.13): which editor a project uses, starting it at a
 * folder or a file's line, Open all with VS Code and Cursor folders in one
 * window, and saving the choice in config.json (never in a repository).
 */
export class EditorService {
  constructor(
    private readonly config: ConfigStore,
    private readonly context: (
      profileId: string,
      projectId: string | null,
    ) => Promise<EditorContext>,
    private readonly dataDir: string,
  ) {}

  private profile(profileId: string): Profile {
    const profile = this.config.require().profiles.find((p) => p.id === profileId);
    if (!profile) throw new Error(`Unknown profile "${profileId}"`);
    return profile;
  }

  private project(projectId: string): Project {
    const project = this.config.require().projects.find((p) => p.id === projectId);
    if (!project) throw new Error(`Unknown project "${projectId}"`);
    return project;
  }

  /** The known editors installed for this profile. */
  async detect(profileId: string): Promise<FoundEditor[]> {
    const { env } = await this.context(profileId, null);
    const home = env.HOME || os.homedir();
    return EDITOR_KINDS.flatMap((kind) => {
      const install = findInstall(kind, env, home);
      return install ? [{ kind, label: KNOWN_EDITORS[kind].label, install }] : [];
    });
  }

  /** The editor of a project (or the profile's), with where it was set; throws NO_EDITOR. */
  editorOf(profileId: string, projectId: string | null) {
    const chosen = editorFor(this.profile(profileId), projectId ? this.project(projectId) : null);
    if (!chosen) throw new Error(NO_EDITOR);
    return chosen;
  }

  /** Opens a folder or a file at a line in the project's editor. */
  async open(profileId: string, projectId: string | null, target: EditorTarget): Promise<void> {
    const { editor, source } = this.editorOf(profileId, projectId);
    await this.start(profileId, projectId, editor, source, target);
  }

  /**
   * Open all (spec §6.13): each repository in its project's editor; the ones
   * sharing VS Code or Cursor as one window, from a `.code-workspace` file in
   * the app's data folder.
   */
  async openAll(
    workspace: Workspace,
    repos: { projectId: string; worktreePath: string; name: string }[],
  ): Promise<void> {
    const planned = repos.map((repo) => ({
      ...repo,
      ...this.editorOf(workspace.profileId, repo.projectId),
    }));
    const failures: string[] = [];
    for (const window of editorWindows(planned)) {
      const [first] = window as [(typeof planned)[number]];
      const folder =
        window.length > 1 && isMultiRoot(first.editor)
          ? this.writeCodeWorkspace(workspace, first.editor, window)
          : first.worktreePath;
      try {
        await this.start(workspace.profileId, first.projectId, first.editor, first.source, {
          kind: 'folder',
          path: folder,
        });
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (failures.length > 0) throw new Error(failures.join('\n'));
  }

  /** The `.code-workspace` file of a workspace's folders for one editor, rewritten each time. */
  private writeCodeWorkspace(
    workspace: Workspace,
    editor: Editor,
    repos: { worktreePath: string; name: string }[],
  ): string {
    const dir = path.join(this.dataDir, 'editor-workspaces');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${workspace.id}-${editor.kind}.code-workspace`);
    const folders = repos.map((r) => ({ name: r.name, path: r.worktreePath }));
    fs.writeFileSync(file, `${JSON.stringify({ folders, settings: {} }, null, 2)}\n`);
    return file;
  }

  /** Removes a deleted workspace's `.code-workspace` files. */
  forget(workspaceId: string): void {
    const dir = path.join(this.dataDir, 'editor-workspaces');
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(`${workspaceId}-`)) fs.rmSync(path.join(dir, name), { force: true });
    }
  }

  /** Saves the profile's editor (null clears it). */
  setProfileEditor(profileId: string, editor: Editor | null): void {
    this.config.update((raw) => {
      const entry = (Array.isArray(raw.profiles) ? raw.profiles : []).find(
        (p) => (p as { id?: unknown }).id === profileId,
      ) as Record<string, unknown> | undefined;
      if (!entry) throw new Error(`Unknown profile "${profileId}"`);
      if (editor) entry.editor = editor;
      else delete entry.editor;
    });
  }

  /** Saves a project's own editor; null makes it use the profile's. */
  setProjectEditor(projectId: string, editor: Editor | null): void {
    this.config.update((raw) => {
      const entry = (Array.isArray(raw.projects) ? raw.projects : []).find(
        (p) => (p as { id?: unknown }).id === projectId,
      ) as Record<string, unknown> | undefined;
      if (!entry) throw new Error(`Unknown project "${projectId}"`);
      if (editor) entry.editor = editor;
      else delete entry.editor;
    });
  }

  private async start(
    profileId: string,
    projectId: string | null,
    editor: Editor,
    source: 'project' | 'profile',
    target: EditorTarget,
  ): Promise<void> {
    const { env, shell } = await this.context(profileId, projectId);
    const home = env.HOME || os.homedir();
    const install = editor.kind === 'custom' ? null : findInstall(editor.kind, env, home);
    const where =
      source === 'project' && projectId
        ? `${this.project(projectId).name}'s Setup tab › Editor`
        : 'Edit profile › General › Editor';
    if (editor.kind !== 'custom' && !install) {
      throw new Error(
        `Couldn't open ${editorLabel(editor)}: its command \`${KNOWN_EDITORS[editor.kind].command}\` wasn't found. Choose another editor in ${where}.`,
      );
    }
    const run = editorInvocation(editor, target, install);
    const failure = await runDetached(run, { env, shell, cwd: expandHome('~', home) });
    if (failure) {
      throw new Error(
        `Couldn't open ${editorLabel(editor)}: \`${invocationText(run)}\` ${failure}. Check the editor in ${where}.`,
      );
    }
  }
}

/**
 * Starts an editor and lets it run. Resolves with why it failed (not found,
 * exited non-zero, with its first error line) when that happens within a few
 * seconds, else null.
 */
function runDetached(
  run: Invocation,
  { env, shell, cwd }: { env: Record<string, string>; shell: string; cwd: string },
): Promise<string | null> {
  return new Promise((resolve) => {
    const [program, args] = 'shell' in run ? [shell, ['-c', run.shell]] : [run.program, run.args];
    let stderr = '';
    let settled = false;
    const done = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stderr?.removeAllListeners();
      child.unref();
      resolve(value);
    };
    const child = spawn(program, args, {
      cwd: fs.existsSync(cwd) ? cwd : os.homedir(),
      env,
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const timer = setTimeout(() => done(null), SETTLE_MS);
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 2000) stderr += chunk.toString('utf8');
    });
    child.on('error', (error: NodeJS.ErrnoException) =>
      done(error.code === 'ENOENT' ? 'was not found' : `failed: ${error.message}`),
    );
    child.on('exit', (code, signal) => {
      if (code === 0) return done(null);
      // 127: the shell didn't find the command.
      const why = code === 127 ? 'was not found' : `exited with ${code ?? signal}`;
      const line = stderr.trim().split('\n')[0]?.trim();
      done(line ? `${why} (${line})` : why);
    });
  });
}
