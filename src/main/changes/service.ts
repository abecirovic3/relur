import fs from 'node:fs';
import path from 'node:path';
import type { ChangedFile, ChangeGroup, FileDiff, WorkspaceChanges } from '@shared/changes';
import type { Project } from '@shared/schemas';
import type { Workspace } from '@shared/workspaces';
import type { Git } from '../git/git';

/** Files above this size aren't shown in the diff viewer. */
const MAX_DIFF_BYTES = 2 * 1024 * 1024;

const looksBinary = (data: Buffer) => data.subarray(0, 8000).includes(0);

/** One repository's worktree of a workspace and its base branch (spec §21.5). */
export type RepoView = Pick<Workspace, 'worktreePath' | 'baseBranch'>;

/** The ref a workspace is compared with: its base on the remote, or the local base branch. */
export async function baseRef(git: Git, project: Project, workspace: RepoView): Promise<string> {
  if (project.remote) {
    const remote = `${project.remote}/${workspace.baseBranch}`;
    if (await git.revParse(workspace.worktreePath, `refs/remotes/${remote}`)) return remote;
  }
  return workspace.baseBranch;
}

function lineCount(file: string): { added: number; binary: boolean } {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return { added: 0, binary: false };
    if (stat.size > MAX_DIFF_BYTES) return { added: 0, binary: true };
    const data = fs.readFileSync(file);
    if (looksBinary(data)) return { added: 0, binary: true };
    const text = data.toString('utf8');
    return {
      added: text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0),
      binary: false,
    };
  } catch {
    return { added: 0, binary: false };
  }
}

/**
 * The Changes panel's data (spec §6.4): commits since the merge base with
 * the base branch, and uncommitted changes (including untracked files),
 * as separate groups.
 */
export async function workspaceChanges(
  git: Git,
  project: Project,
  workspace: RepoView,
): Promise<WorkspaceChanges> {
  const dir = workspace.worktreePath;
  const base = await baseRef(git, project, workspace);
  const mergeBase = await git.mergeBase(dir, base, 'HEAD');
  const [committed, tracked, untracked] = await Promise.all([
    mergeBase ? git.diffFiles(dir, mergeBase, 'HEAD') : Promise.resolve([]),
    git.diffFiles(dir, 'HEAD', null),
    git.untrackedFiles(dir),
  ]);
  const uncommitted: ChangedFile[] = [
    ...tracked,
    ...untracked.map((p) => ({
      kind: 'A' as const,
      path: p,
      oldPath: null,
      removed: 0,
      ...lineCount(path.join(dir, p)),
    })),
  ].sort((a, b) => a.path.localeCompare(b.path));
  const all = [...committed, ...uncommitted];
  return {
    base,
    mergeBase,
    committed,
    uncommitted,
    added: all.reduce((n, f) => n + f.added, 0),
    removed: all.reduce((n, f) => n + f.removed, 0),
  };
}

function text(data: Buffer | null): { text: string | null; binary: boolean; tooLarge: boolean } {
  if (!data) return { text: null, binary: false, tooLarge: false };
  if (data.length > MAX_DIFF_BYTES) return { text: null, binary: true, tooLarge: true };
  if (looksBinary(data)) return { text: null, binary: true, tooLarge: false };
  return { text: data.toString('utf8'), binary: false, tooLarge: false };
}

/** Both sides of a changed file, read from git and the worktree. */
export async function fileDiff(
  git: Git,
  workspace: RepoView,
  group: ChangeGroup,
  file: { path: string; oldPath: string | null },
  mergeBase: string | null,
): Promise<FileDiff> {
  const dir = workspace.worktreePath;
  const inside = path.resolve(dir, file.path);
  if (path.relative(dir, inside).startsWith('..'))
    throw new Error('That file is outside the worktree');
  const before = group === 'committed' ? mergeBase : 'HEAD';
  const original = before ? await git.showFile(dir, before, file.oldPath ?? file.path) : null;
  let modified: Buffer | null;
  if (group === 'committed') modified = await git.showFile(dir, 'HEAD', file.path);
  else {
    try {
      modified = fs.statSync(inside).isFile() ? fs.readFileSync(inside) : null;
    } catch {
      modified = null;
    }
  }
  const a = text(original);
  const b = text(modified);
  if (a.binary || b.binary) return { binary: true, tooLarge: a.tooLarge || b.tooLarge };
  return { binary: false, original: a.text, modified: b.text };
}
