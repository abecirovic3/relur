import { BRAND } from './brand';

/** The hidden folder made inside a chosen worktree folder (spec §8.1). */
export const WORKTREES_DIR = '.worktrees';

/**
 * Where a project's worktrees go (spec §8.1), with `~` unexpanded: in the
 * folder it chose, `<folder>/.worktrees/<project>`; otherwise
 * `<profile worktreeRoot>/<project>`, by default
 * `~/<home dir>/worktrees/<profile>/<project>`.
 */
export function projectWorktreeDir(
  profile: { id: string; defaults: { worktreeRoot?: string } },
  project: { id: string; worktreeRoot?: string | null },
): string {
  const trim = (p: string) => p.replace(/[/\\]+$/, '');
  if (project.worktreeRoot) return `${trim(project.worktreeRoot)}/${WORKTREES_DIR}/${project.id}`;
  const root = profile.defaults.worktreeRoot ?? `~/${BRAND.homeDirName}/worktrees/${profile.id}`;
  return `${trim(root)}/${project.id}`;
}

/** A project's id before de-duplication, from its name. */
export function projectSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[^a-z0-9]+|-+$/g, '') || 'project'
  );
}
