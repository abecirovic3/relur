import fs from 'node:fs';
import path from 'node:path';
import { WORKTREES_DIR } from '@shared/projects';

/** Why a folder one level down wasn't offered as a repository (spec §6.1). */
export type SkipReason = 'hidden' | 'node_modules' | 'linked-worktree' | 'bare-repository';

export interface FolderScan {
  /** Absolute paths of the repositories found, sorted by name. */
  repositories: string[];
  /** Folders that look like git but aren't offered, with the reason. */
  skipped: { path: string; reason: SkipReason }[];
}

const isDir = (p: string) => fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false;
const isFile = (p: string) => fs.statSync(p, { throwIfNoEntry: false })?.isFile() ?? false;

/** A bare repository: git's own files at the top, no checkout. */
function isBareRepository(dir: string): boolean {
  return (
    isFile(path.join(dir, 'HEAD')) &&
    isDir(path.join(dir, 'objects')) &&
    isDir(path.join(dir, 'refs'))
  );
}

/**
 * The repositories one level below `folder`, for adding a folder of
 * repositories at once (spec §6.1). Hidden folders (including `.worktrees`),
 * `node_modules`, linked worktrees and submodules (a `.git` file pointing into
 * another repository) and bare repositories are skipped. Folders that aren't
 * repositories are left out silently.
 */
export function scanForRepositories(folder: string): FolderScan {
  const repositories: string[] = [];
  const skipped: FolderScan['skipped'] = [];
  const entries = fs.readdirSync(folder).sort((a, b) => a.localeCompare(b));
  for (const name of entries) {
    const dir = path.join(folder, name);
    if (!isDir(dir)) continue;
    if (name.startsWith('.') || name === WORKTREES_DIR) {
      skipped.push({ path: dir, reason: 'hidden' });
    } else if (name === 'node_modules') {
      skipped.push({ path: dir, reason: 'node_modules' });
    } else if (isFile(path.join(dir, '.git'))) {
      skipped.push({ path: dir, reason: 'linked-worktree' });
    } else if (isDir(path.join(dir, '.git'))) {
      repositories.push(dir);
    } else if (isBareRepository(dir)) {
      skipped.push({ path: dir, reason: 'bare-repository' });
    }
  }
  return { repositories, skipped };
}

/** Runs `run` over `items` with at most `limit` at a time, keeping the order of results. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index] as T, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
