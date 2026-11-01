import type { Profile } from '@shared/schemas';
import { useEffect, useState } from 'react';
import { type AppRouterOutputs, trpcClient } from '../trpc';

type Candidate = AppRouterOutputs['projects']['inspect'];
export type AddManyResult = AppRouterOutputs['projects']['addMany'][number];

/** How many repositories are inspected at once (as `INSPECT_LIMIT` in the main process). */
const LIMIT = 4;

export interface FolderRow {
  repoPath: string;
  candidate: Candidate | null;
  error: string | null;
}

/** Why a row can't be ticked, or null (rule R1: a repository belongs to one profile). */
export function rowBlocker(row: FolderRow, profile: Profile): string | null {
  if (row.error) return row.error;
  const conflict = row.candidate?.conflict;
  if (!conflict) return null;
  return conflict.profileId === profile.id ? 'already added' : `in ${conflict.profileName}`;
}

/**
 * Inspects the repositories of a folder, a few at a time (spec §6.1). New
 * ones start ticked; ones already registered can't be.
 */
export function useFolderRows(repositories: string[] | null, profile: Profile) {
  const [rows, setRows] = useState<FolderRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const key = repositories?.join('\n') ?? '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per list of repositories
  useEffect(() => {
    const paths = repositories ?? [];
    let cancelled = false;
    setRows(paths.map((repoPath) => ({ repoPath, candidate: null, error: null })));
    setSelected(new Set());
    let next = 0;
    const worker = async () => {
      while (!cancelled && next < paths.length) {
        const index = next++;
        const repoPath = paths[index] as string;
        const row: FolderRow = await trpcClient.projects.inspect
          .mutate({ folder: repoPath, profileId: profile.id })
          .then(
            (candidate) => ({ repoPath, candidate, error: null }),
            (e: unknown) => ({
              repoPath,
              candidate: null,
              error: e instanceof Error ? e.message : String(e),
            }),
          );
        if (cancelled) return;
        setRows((current) => current.map((r, i) => (i === index ? row : r)));
        if (!rowBlocker(row, profile)) {
          setSelected((current) => new Set(current).add(repoPath));
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(LIMIT, paths.length) }, worker));
    return () => {
      cancelled = true;
    };
  }, [key, profile.id]);
  const inspected = rows.filter((r) => r.candidate || r.error).length;
  return { rows, selected, setSelected, inspected, done: inspected === rows.length };
}

const name = (p: string) => p.split(/[/\\]/).pop() ?? p;

/** The checkbox list of a folder's repositories, with Select all / Select none. */
export function FolderImportList({
  profile,
  rows,
  selected,
  setSelected,
  inspected,
  skipped,
}: ReturnType<typeof useFolderRows> & {
  profile: Profile;
  skipped: { path: string; reason: string }[];
}) {
  const selectable = rows.filter((r) => r.candidate && !rowBlocker(r, profile));
  const skippedGit = skipped.filter(
    (s) => s.reason === 'linked-worktree' || s.reason === 'bare-repository',
  );
  const toggle = (repoPath: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(repoPath);
      else next.delete(repoPath);
      return next;
    });
  return (
    <div className="mt-3 rounded-lg border border-line bg-surface text-sm" data-folder-import>
      <div className="flex h-8 items-center gap-3 border-b border-line px-3">
        <span className="text-fg-muted">
          {inspected < rows.length
            ? `Inspecting ${inspected} of ${rows.length}…`
            : `${rows.length} ${rows.length === 1 ? 'repository' : 'repositories'} in this folder`}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          className="text-fg-muted underline-offset-2 hover:text-fg hover:underline disabled:opacity-40"
          disabled={selectable.length === 0}
          onClick={() => setSelected(new Set(selectable.map((r) => r.repoPath)))}
        >
          Select all
        </button>
        <button
          type="button"
          className="text-fg-muted underline-offset-2 hover:text-fg hover:underline disabled:opacity-40"
          disabled={selected.size === 0}
          onClick={() => setSelected(new Set())}
        >
          Select none
        </button>
      </div>
      <ul className="max-h-60 overflow-y-auto p-1">
        {rows.map((row) => {
          const blocker = rowBlocker(row, profile);
          const c = row.candidate;
          return (
            <li key={row.repoPath}>
              <label
                data-repo={name(row.repoPath)}
                title={row.repoPath}
                className={`grid h-7 grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-sm px-2 ${blocker ? 'text-fg-subtle' : 'hover:bg-raised'}`}
              >
                <input
                  type="checkbox"
                  aria-label={name(row.repoPath)}
                  disabled={!c || blocker !== null}
                  checked={selected.has(row.repoPath)}
                  onChange={(e) => toggle(row.repoPath, e.target.checked)}
                />
                <span className="truncate">
                  <span className="font-mono">{name(row.repoPath)}</span>
                  {c ? (
                    <span className="ml-2 font-mono text-xs text-fg-subtle">
                      {c.remote ?? 'no remote'} · {c.baseBranch}
                    </span>
                  ) : null}
                </span>
                <span
                  className={`truncate text-xs ${row.error ? 'text-st-error' : 'text-fg-subtle'}`}
                  data-repo-note
                >
                  {!c && !row.error ? 'checking…' : (blocker ?? '')}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {skippedGit.length > 0 ? (
        <p className="border-t border-line px-3 py-1.5 text-xs text-fg-subtle">
          Not offered:{' '}
          {skippedGit.map((s) => `${name(s.path)} (${s.reason.replace('-', ' ')})`).join(', ')}
        </p>
      ) : null}
    </div>
  );
}

/** What adding did, per repository. */
export function FolderImportResults({ results }: { results: AddManyResult[] }) {
  return (
    <ul
      className="mt-3 space-y-1 rounded-lg border border-line bg-surface p-3 text-sm"
      data-import-results
    >
      {results.map((r) => (
        <li key={r.repoPath} className="flex gap-2">
          {r.ok ? (
            <span className="text-diff-add">✓</span>
          ) : (
            <span className="text-st-error">✕</span>
          )}
          <span className="font-mono">{name(r.repoPath)}</span>
          <span className="min-w-0 truncate text-fg-muted select-text">
            {r.ok ? `added as ${r.project.id}` : r.error}
          </span>
        </li>
      ))}
    </ul>
  );
}
