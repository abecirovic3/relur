import { projectSlug, projectWorktreeDir } from '@shared/projects';
import type { Profile, Project } from '@shared/schemas';
import { matchShortcut } from '@shared/shortcuts';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { GuideLink } from '../guide/link';
import { type AppRouterOutputs, useTRPC } from '../trpc';
import { button, inputClass, isMac, Kbd, keyHint, labelClass } from '../ui/controls';
import {
  type AddManyResult,
  FolderImportList,
  FolderImportResults,
  useFolderRows,
} from './FolderImport';
import { Modal, ModalFooter } from './Modal';

type Candidate = AppRouterOutputs['projects']['inspect'];

const BASE_BRANCH_SOURCE: Record<Candidate['baseBranchSource'], string> = {
  'remote-head': 'from the remote default branch',
  'current-branch': 'the currently checked-out branch',
  'profile-default': "the profile default; the remote's default branch is not known locally",
};

/**
 * Add project (spec §6.1): pick or type a folder, review what was detected,
 * confirm. A folder that isn't a repository offers the repositories in it.
 */
export function AddProjectDialog({
  profile,
  onClose,
  onAdded,
}: {
  profile: Profile;
  onClose: () => void;
  onAdded: (project: Project) => void;
}) {
  const trpc = useTRPC();
  const [folder, setFolder] = useState('');
  // Edits of the detected values; null means "use what was detected".
  const [nameEdit, setName] = useState<string | null>(null);
  const [remoteEdit, setRemote] = useState<string | null>(null);
  const [baseBranchEdit, setBaseBranch] = useState<string | null>(null);
  const inspectedFolder = useRef<string | null>(null);
  // The project's own worktree folder (§8.1); null keeps the default.
  const [worktreeRoot, setWorktreeRoot] = useState<string | null>(null);

  const pickFolder = useMutation(trpc.projects.pickFolder.mutationOptions());
  const inspect = useMutation(trpc.projects.examine.mutationOptions());
  const add = useMutation(trpc.projects.add.mutationOptions({ onSuccess: onAdded }));
  const addMany = useMutation(trpc.projects.addMany.mutationOptions());
  const [results, setResults] = useState<AddManyResult[] | null>(null);
  const pickWorktrees = useMutation(trpc.projects.pickWorktreeFolder.mutationOptions());
  const chooseWorktrees = async () => {
    try {
      const picked = await pickWorktrees.mutateAsync();
      if (picked) setWorktreeRoot(picked);
    } catch {
      // Shown below from pickWorktrees.error.
    }
  };

  const check = (path: string) => {
    const trimmed = path.trim();
    if (!trimmed || trimmed === inspectedFolder.current) return;
    inspectedFolder.current = trimmed;
    setName(null);
    setRemote(null);
    setBaseBranch(null);
    add.reset();
    addMany.reset();
    setResults(null);
    inspect.mutate({ folder: trimmed, profileId: profile.id });
  };

  const browse = async () => {
    try {
      const picked = await pickFolder.mutateAsync();
      if (picked) {
        setFolder(picked);
        check(picked);
      }
    } catch {
      // Shown below from pickFolder.error.
    }
  };

  // Detection runs 250 ms after typing stops (components.md, Path field).
  const checkRef = useRef(check);
  checkRef.current = check;
  useEffect(() => {
    const timer = setTimeout(() => checkRef.current(folder), 250);
    return () => clearTimeout(timer);
  }, [folder]);

  // Details belong to the folder in the field only while it hasn't been edited.
  const examined = inspect.data && inspectedFolder.current === folder.trim() ? inspect.data : null;
  const candidate = examined?.kind === 'repository' ? examined.candidate : null;
  const scan = examined?.kind === 'folder' ? examined : null;
  const folderRows = useFolderRows(scan?.repositories ?? null, profile);
  const chosen = folderRows.rows.filter((r) => r.candidate && folderRows.selected.has(r.repoPath));
  const name = nameEdit ?? candidate?.name ?? '';
  const remote = remoteEdit ?? candidate?.remote ?? null;
  const baseBranch = baseBranchEdit ?? candidate?.baseBranch ?? '';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (results) {
      onClose();
      return;
    }
    if (scan) {
      if (chosen.length === 0) return;
      addMany.mutate(
        {
          profileId: profile.id,
          items: chosen.map(({ candidate: c }) => ({
            repoPath: c?.repoPath ?? '',
            name: c?.name ?? '',
            remote: c?.remote ?? null,
            baseBranch: c?.baseBranch ?? '',
          })),
          worktreeRoot,
        },
        { onSuccess: setResults },
      );
      return;
    }
    if (!candidate || candidate.conflict) return;
    add.mutate({
      profileId: profile.id,
      repoPath: candidate.repoPath,
      name,
      remote,
      baseBranch,
      worktreeRoot,
    });
  };

  const error =
    pickFolder.error ??
    pickWorktrees.error ??
    (inspect.isPending ? null : inspect.error) ??
    add.error ??
    addMany.error;

  const detailRow = 'grid grid-cols-[104px_1fr] items-center gap-3';
  const detailInput = `${inputClass} h-6.5 font-mono text-sm`;

  // Where the worktrees go (§8.1); for a folder of repositories, for all of them.
  const worktreeChoice = (
    <div className={`${detailRow} items-start`}>
      <span className="flex items-center gap-1.5 pt-0.5 text-fg-muted">
        Worktrees{' '}
        <GuideLink to="worktrees#a-folder-you-choose" label="Where worktrees go" before={onClose} />
      </span>
      <fieldset aria-label="Worktrees" className="min-w-0 space-y-1">
        <label className="flex min-w-0 items-center gap-2">
          <input
            type="radio"
            name="worktrees"
            checked={worktreeRoot === null}
            onChange={() => setWorktreeRoot(null)}
          />
          Default{' '}
          <span className="truncate font-mono text-fg-muted">
            {projectWorktreeDir(profile, { id: scan ? '<project>' : projectSlug(name) })}
          </span>
        </label>
        <label className="flex min-w-0 items-center gap-2">
          <input
            type="radio"
            name="worktrees"
            checked={worktreeRoot !== null}
            onChange={() => void chooseWorktrees()}
          />
          {worktreeRoot ? (
            <span data-worktree-root className="truncate font-mono">
              {projectWorktreeDir(profile, {
                id: scan ? '<project>' : projectSlug(name),
                worktreeRoot,
              })}
            </span>
          ) : (
            'Choose folder…'
          )}
          {worktreeRoot ? (
            <button
              type="button"
              className={button('ghost', 'sm')}
              onClick={() => void chooseWorktrees()}
            >
              Change…
            </button>
          ) : null}
        </label>
      </fieldset>
    </div>
  );

  return (
    <Modal
      title="Add project"
      description={
        <>
          Adds a git repository to <span className="font-medium text-fg">{profile.name}</span>.
        </>
      }
      onClose={onClose}
    >
      <form onSubmit={submit} className="text-md">
        <label htmlFor="add-project-folder" className={labelClass}>
          Repository path
        </label>
        <div className="flex gap-2">
          <input
            id="add-project-folder"
            className={`${inputClass} font-mono text-sm`}
            placeholder="~/code/my-repository"
            spellCheck={false}
            value={folder}
            aria-invalid={Boolean(inspect.error) || undefined}
            onChange={(e) => setFolder(e.target.value)}
            onBlur={() => check(folder)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !candidate) {
                e.preventDefault();
                check(folder);
              }
              if (matchShortcut('browse', e.nativeEvent, isMac) !== -1) {
                e.preventDefault();
                void browse();
              }
            }}
          />
          <button
            type="button"
            className={button('secondary', 'lg')}
            disabled={pickFolder.isPending}
            onClick={() => void browse()}
          >
            Browse… <Kbd>{keyHint('browse')}</Kbd>
          </button>
        </div>
        {inspect.isPending ? <p className="mt-1.5 text-sm text-fg-subtle">Checking…</p> : null}

        {candidate?.conflict ? (
          <p role="alert" className="mt-2 text-sm text-st-error">
            ✕ This repository is already registered under the {candidate.conflict.profileName}{' '}
            profile. A repository can belong to only one profile.
          </p>
        ) : null}

        {candidate && !candidate.conflict ? (
          <div className="mt-3 space-y-2 rounded-lg border border-line bg-surface p-3 text-sm">
            <div className={detailRow}>
              <span className="text-fg-muted">Detected</span>
              <span>
                <span className="text-diff-add">✓</span> Git repository
              </span>
            </div>
            {candidate.repoPath !== folder.trim() ? (
              <div className={detailRow}>
                <span className="text-fg-muted">Main checkout</span>
                <span className="truncate font-mono select-text">{candidate.repoPath}</span>
              </div>
            ) : null}
            <label className={detailRow}>
              <span className="text-fg-muted">Name</span>
              <input
                className={detailInput}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className={detailRow}>
              <span className="text-fg-muted">Base branch</span>
              <div>
                <input
                  aria-label="Base branch"
                  className={detailInput}
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                />
                {baseBranch === candidate.baseBranch ? (
                  <span className="mt-0.5 block text-xs text-fg-subtle">
                    {BASE_BRANCH_SOURCE[candidate.baseBranchSource]}
                  </span>
                ) : null}
              </div>
            </div>
            <div className={detailRow}>
              <span className="text-fg-muted">Remote</span>
              {candidate.remotes.length > 0 ? (
                <select
                  aria-label="Remote"
                  className={detailInput}
                  value={remote ?? ''}
                  onChange={(e) => setRemote(e.target.value)}
                >
                  {candidate.remotes.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-fg-muted">None: workspaces branch from local branches</span>
              )}
            </div>
            {worktreeChoice}
          </div>
        ) : null}

        {scan && !results ? (
          <>
            <FolderImportList profile={profile} skipped={scan.skipped} {...folderRows} />
            <div className="mt-3 rounded-lg border border-line bg-surface p-3 text-sm">
              {worktreeChoice}
            </div>
          </>
        ) : null}
        {results ? <FolderImportResults results={results} /> : null}

        {error ? (
          <p role="alert" className="mt-2 text-sm text-st-error select-text">
            ✕ {error.message}
          </p>
        ) : null}

        <ModalFooter>
          <button type="button" className={button('ghost', 'lg')} onClick={onClose}>
            Cancel <Kbd>Esc</Kbd>
          </button>
          {results ? (
            <button type="submit" className={button('primary', 'lg')}>
              Done <Kbd onFg>{keyHint('confirm')}</Kbd>
            </button>
          ) : scan ? (
            <button
              type="submit"
              className={button('primary', 'lg')}
              disabled={chosen.length === 0 || addMany.isPending}
            >
              Add {chosen.length} {chosen.length === 1 ? 'project' : 'projects'}{' '}
              <Kbd onFg>{keyHint('confirm')}</Kbd>
            </button>
          ) : (
            <button
              type="submit"
              className={button('primary', 'lg')}
              disabled={
                !candidate ||
                candidate.conflict !== null ||
                add.isPending ||
                !name.trim() ||
                !baseBranch.trim()
              }
            >
              Add project <Kbd onFg>{keyHint('confirm')}</Kbd>
            </button>
          )}
        </ModalFooter>
      </form>
    </Modal>
  );
}
