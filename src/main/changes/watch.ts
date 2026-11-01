import fs from 'node:fs';
import path from 'node:path';

/** Changes closer together than this are reported once. */
export const WATCH_DEBOUNCE_MS = 300;
/** How often the count is checked instead when the OS has no watches left (Linux). */
export const WATCH_POLL_MS = 3000;
/** Errors that mean no more watches: the inotify limits (Linux), or no file handles left. */
const LIMIT_ERRORS = new Set(['ENOSPC', 'EMFILE']);
/** Above this many folders a worktree isn't watched folder by folder (Linux). */
const MAX_DIRS = 4000;
/** Folders not worth watching: git's own, and installed dependencies. */
const SKIPPED = new Set(['.git', 'node_modules']);
/** The worktree's own files in its git dir that change on commit, stage or checkout. */
const GIT_FILES = new Set(['HEAD', 'index', 'ORIG_HEAD']);

/** Whether a changed path (relative to the worktree) is inside a skipped folder. */
export function ignoredChange(relative: string): boolean {
  return relative.split(/[/\\]/).some((part) => SKIPPED.has(part));
}

/** The worktree's own git dir: `.git` itself, or the folder its `.git` file points to. */
export function worktreeGitDir(worktree: string): string | null {
  const dotGit = path.join(worktree, '.git');
  try {
    if (fs.statSync(dotGit).isDirectory()) return dotGit;
    const match = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'));
    return match?.[1] ? path.resolve(worktree, match[1].trim()) : null;
  } catch {
    return null;
  }
}

type Close = () => void;

/** Called when a watch failed because the OS has none left. */
type OnLimit = () => void;

function tryWatch(
  target: string,
  options: fs.WatchOptions,
  listener: (name: string | null) => void,
  onLimit: OnLimit,
): fs.FSWatcher | null {
  const failed = (error: unknown) => {
    if (LIMIT_ERRORS.has((error as NodeJS.ErrnoException)?.code ?? '')) onLimit();
  };
  try {
    const watcher = fs.watch(target, options, (_event, name) =>
      listener(name === null ? null : String(name)),
    );
    watcher.on('error', (error) => {
      watcher.close();
      failed(error);
    });
    return watcher;
  } catch (error) {
    failed(error);
    return null;
  }
}

/**
 * Watches one worktree's files (spec §6.4): recursively where the OS does it
 * natively (macOS, Windows), otherwise folder by folder, skipping `.git` and
 * `node_modules`, and picking up new folders as they appear.
 */
function watchTree(root: string, onChange: () => void, onLimit: OnLimit): Close {
  const report = (relative: string | null) => {
    if (relative === null || !ignoredChange(relative)) onChange();
  };
  if (process.platform === 'darwin' || process.platform === 'win32') {
    const watcher = tryWatch(root, { recursive: true }, report, onLimit);
    return () => watcher?.close();
  }
  const watchers = new Map<string, fs.FSWatcher>();
  const add = (dir: string) => {
    const pending = [dir];
    while (pending.length > 0 && watchers.size < MAX_DIRS) {
      const current = pending.pop() as string;
      if (watchers.has(current)) continue;
      const watcher = tryWatch(
        current,
        {},
        (name) => {
          const relative = path.relative(root, name ? path.join(current, name) : current);
          if (name && !ignoredChange(relative)) {
            // A new folder gets its own watcher.
            const full = path.join(current, name);
            try {
              if (fs.statSync(full).isDirectory()) add(full);
            } catch {
              // Removed again; its watcher closes itself.
            }
          }
          report(relative);
        },
        onLimit,
      );
      if (!watcher) continue;
      watchers.set(current, watcher);
      watcher.on('close', () => watchers.delete(current));
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        // Unreadable: watched without its subfolders.
      }
      for (const entry of entries) {
        if (entry.isDirectory() && !SKIPPED.has(entry.name)) {
          pending.push(path.join(current, entry.name));
        }
      }
    }
  };
  add(root);
  return () => {
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
  };
}

/**
 * Watches a workspace's worktrees for the Changes count (spec §6.4, §21.5):
 * their files, and the worktree's git dir for commits and staging, and calls
 * `onChange` once per burst of changes. Only the shown workspace is watched.
 * When the OS has no watches left (Linux's inotify limit, spec §6.4), it
 * calls `onChange` every few seconds instead and `onLimit` once.
 */
export function watchWorktrees(
  worktrees: string[],
  onChange: () => void,
  onLimit: () => void = () => {},
  pollMs = WATCH_POLL_MS,
): Close {
  let timer: NodeJS.Timeout | null = null;
  let poll: NodeJS.Timeout | null = null;
  let closed = false;
  const limited = () => {
    if (closed || poll) return;
    poll = setInterval(() => {
      if (!closed) onChange();
    }, pollMs);
    onLimit();
  };
  const changed = () => {
    if (closed || timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (!closed) onChange();
    }, WATCH_DEBOUNCE_MS);
  };
  const closers: Close[] = [];
  for (const worktree of worktrees) {
    closers.push(watchTree(worktree, changed, limited));
    const gitDir = worktreeGitDir(worktree);
    if (gitDir) {
      const watcher = tryWatch(
        gitDir,
        {},
        (name) => {
          if (name === null || GIT_FILES.has(name)) changed();
        },
        limited,
      );
      closers.push(() => watcher?.close());
    }
  }
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    if (poll) clearInterval(poll);
    for (const close of closers) close();
  };
}
