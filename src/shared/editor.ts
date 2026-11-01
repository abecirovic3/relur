import type { Editor, EditorKind, Profile, Project } from './schemas';
import { shellQuote } from './shell';

/**
 * The editors the app knows (spec §6.13): the command line tool it starts,
 * where it may be installed as an app on macOS, and its arguments for a
 * folder and for a file at a line.
 */
export interface KnownEditor {
  label: string;
  command: string;
  /** App bundle names, tried in /Applications and ~/Applications. */
  apps: string[];
  folder: string[];
  file: string[];
  /** Opens several folders in one window from a `.code-workspace` file. */
  multiRoot: boolean;
  /** Installed by JetBrains Toolbox, which keeps its command line tools in its own folder. */
  toolbox: boolean;
  /** Linux: other names of its command, from snap, flatpak (the app id) or distribution packages. */
  linux: string[];
}

export const KNOWN_EDITORS: Record<EditorKind, KnownEditor> = {
  vscode: {
    label: 'VS Code',
    command: 'code',
    apps: ['Visual Studio Code.app'],
    folder: ['{path}'],
    file: ['-g', '{file}:{line}'],
    multiRoot: true,
    toolbox: false,
    linux: ['com.visualstudio.code'],
  },
  cursor: {
    label: 'Cursor',
    command: 'cursor',
    apps: ['Cursor.app'],
    folder: ['{path}'],
    file: ['-g', '{file}:{line}'],
    multiRoot: true,
    toolbox: false,
    linux: [],
  },
  idea: {
    label: 'IntelliJ IDEA',
    command: 'idea',
    apps: ['IntelliJ IDEA.app', 'IntelliJ IDEA Ultimate.app', 'IntelliJ IDEA CE.app'],
    folder: ['{path}'],
    file: ['--line', '{line}', '{file}'],
    multiRoot: false,
    toolbox: true,
    linux: [
      'intellij-idea-ultimate',
      'intellij-idea-community',
      'com.jetbrains.IntelliJ-IDEA-Ultimate',
      'com.jetbrains.IntelliJ-IDEA-Community',
    ],
  },
  webstorm: {
    label: 'WebStorm',
    command: 'webstorm',
    apps: ['WebStorm.app'],
    folder: ['{path}'],
    file: ['--line', '{line}', '{file}'],
    multiRoot: false,
    toolbox: true,
    linux: ['com.jetbrains.WebStorm'],
  },
  zed: {
    label: 'Zed',
    command: 'zed',
    apps: ['Zed.app'],
    folder: ['{path}'],
    file: ['{file}:{line}'],
    multiRoot: false,
    toolbox: false,
    linux: ['zeditor', 'dev.zed.Zed'],
  },
};

/** An editor's name as the settings show it. */
export const editorLabel = (editor: Editor) =>
  editor.kind === 'custom' ? 'Custom command' : KNOWN_EDITORS[editor.kind].label;

/** Whether the editor can open several folders as one window (`.code-workspace`). */
export const isMultiRoot = (editor: Editor) =>
  editor.kind !== 'custom' && KNOWN_EDITORS[editor.kind].multiRoot;

/** The editor a project uses: its own, else its profile's; null when neither is set. */
export function editorFor(
  profile: Pick<Profile, 'editor'>,
  project: Pick<Project, 'editor'> | null | undefined,
): { editor: Editor; source: 'project' | 'profile' } | null {
  if (project?.editor) return { editor: project.editor, source: 'project' };
  if (profile.editor) return { editor: profile.editor, source: 'profile' };
  return null;
}

/** What to open: a folder (or a `.code-workspace` file), or a file at a line. */
export type EditorTarget =
  | { kind: 'folder'; path: string }
  | { kind: 'file'; file: string; line: number };

/** How a known editor was found: its command line tool, or its app (macOS `open`). */
export type EditorInstall = { how: 'command'; path: string } | { how: 'app'; path: string };

/** A process to start: a program with arguments, or a command line for the user's shell. */
export type Invocation = { program: string; args: string[] } | { shell: string };

const parentOf = (file: string) => file.replace(/[/\\][^/\\]*$/, '') || '/';

const fill = (template: string, values: Record<string, string>, quote: (v: string) => string) =>
  template.replace(/\{(path|file|line)\}/g, (_m, key: string) => quote(values[key] ?? ''));

/**
 * The process that opens `target` in `editor` (spec §6.13). A known editor
 * runs its command line tool, or on macOS its app through `open -na <app>
 * --args`; a custom one runs its command line through the shell with the
 * placeholders shell-quoted, the folder command for a file's folder when it
 * has no file command.
 */
export function editorInvocation(
  editor: Editor,
  target: EditorTarget,
  install: EditorInstall | null,
): Invocation {
  if (editor.kind === 'custom') {
    if (target.kind === 'file' && editor.file) {
      return {
        shell: fill(editor.file, { file: target.file, line: String(target.line) }, shellQuote),
      };
    }
    const folder = target.kind === 'folder' ? target.path : parentOf(target.file);
    return { shell: fill(editor.folder, { path: folder }, shellQuote) };
  }
  const known = KNOWN_EDITORS[editor.kind];
  const values: Record<string, string> =
    target.kind === 'folder'
      ? { path: target.path }
      : { file: target.file, line: String(target.line) };
  const args = (target.kind === 'folder' ? known.folder : known.file).map((a) =>
    fill(a, values, (v) => v),
  );
  if (install?.how === 'app')
    return { program: 'open', args: ['-na', install.path, '--args', ...args] };
  return { program: install?.path ?? known.command, args };
}

/** An invocation as it would be typed, for messages. */
export const invocationText = (run: Invocation) =>
  'shell' in run ? run.shell : [run.program, ...run.args].map(shellQuote).join(' ');

/**
 * The windows Open all would open (spec §6.13): repositories whose editor
 * opens several folders in one window share one per editor; every other
 * repository gets its own.
 */
export function editorWindows<T extends { editor: Editor }>(repos: T[]): T[][] {
  const groups = new Map<string, T[]>();
  const windows: T[][] = [];
  for (const repo of repos) {
    if (!isMultiRoot(repo.editor)) {
      windows.push([repo]);
      continue;
    }
    const group = groups.get(repo.editor.kind);
    if (group) group.push(repo);
    else {
      const created = [repo];
      groups.set(repo.editor.kind, created);
      windows.push(created);
    }
  }
  return windows;
}

/** More windows than this ask first (spec §6.13). */
export const OPEN_ALL_CONFIRM_ABOVE = 3;

/** The error message of Open in editor when neither the project nor its profile has one. */
export const NO_EDITOR = 'No editor is set yet';
