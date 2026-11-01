import { type ChangedFile, type ChangeGroup, diffFirstLine, type FileDiff } from '@shared/changes';
import type { Project } from '@shared/schemas';
import { PR_LABEL, type PrStatus, type Workspace, type WorkspaceRepo } from '@shared/workspaces';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { trpcClient, useTRPC } from '../trpc';
import { button, iconButton, inputClass, keyHint } from '../ui/controls';
import { PrimaryTag } from './DeleteWorkspaceDialog';
import { useOpenInEditor } from './EditorPicker';

type Monaco = typeof import('../monaco');
let loading: Promise<Monaco> | null = null;
/** Monaco loads on first use, so the app starts without it. */
const loadMonaco = () => {
  loading ??= import('../monaco');
  return loading;
};

/** A command's own output, without the lines the app's script prints around it. */
const commandOutput = (output: string) =>
  output
    .split('\n')
    .filter((l) => !/^\$ |^[✓✕] /.test(l))
    .join('\n')
    .trim();

const KIND_COLOR: Record<ChangedFile['kind'], string> = {
  M: 'text-st-permission',
  A: 'text-diff-add',
  D: 'text-diff-del',
  R: 'text-st-permission',
};

/** Read-only diff of one file in Monaco's diff editor, inline or side by side. */
function DiffView({
  diff,
  path,
  split,
  cursorLine,
}: {
  diff: FileDiff;
  path: string;
  split: boolean;
  /** Where the cursor was last put in the new side, for Open in editor (spec §6.13). */
  cursorLine?: { current: number | null };
}) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (diff.binary || !host.current) return;
    let disposed = false;
    let cleanup = () => {};
    void loadMonaco().then(
      ({ monaco, applyMonacoTheme, languageFor }) => {
        if (disposed || !host.current) return;
        applyMonacoTheme();
        const language = languageFor(path);
        const original = monaco.editor.createModel(diff.original ?? '', language);
        const modified = monaco.editor.createModel(diff.modified ?? '', language);
        const editor = monaco.editor.createDiffEditor(host.current, {
          readOnly: true,
          originalEditable: false,
          renderSideBySide: split,
          useInlineViewWhenSpaceIsLimited: false,
          automaticLayout: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          renderOverviewRuler: false,
          hideUnchangedRegions: { enabled: true },
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11.5,
          lineHeight: 18,
          lineNumbersMinChars: 3,
          glyphMargin: false,
          folding: false,
          contextmenu: false,
          links: false,
          renderLineHighlight: 'none',
          scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        });
        editor.setModel({ original, modified });
        if (cursorLine) cursorLine.current = null;
        const cursor = editor.getModifiedEditor().onDidChangeCursorPosition((e) => {
          if (cursorLine && e.source !== 'api') cursorLine.current = e.position.lineNumber;
        });
        // Follows the app's light and dark appearance.
        const observer = new MutationObserver(() => applyMonacoTheme());
        observer.observe(document.documentElement, { attributeFilter: ['data-theme'] });
        cleanup = () => {
          observer.disconnect();
          cursor.dispose();
          editor.dispose();
          original.dispose();
          modified.dispose();
        };
      },
      (e: unknown) => setFailed(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      disposed = true;
      cleanup();
    };
  }, [diff, path, split, cursorLine]);
  if (diff.binary) {
    return (
      <p className="p-4 text-sm text-fg-muted">
        {diff.tooLarge ? 'Too large to show here.' : 'Binary file: no text to compare.'}
      </p>
    );
  }
  if (failed) return <p className="p-4 text-sm text-st-error">✕ {failed}</p>;
  return <div ref={host} data-diff-editor className="h-full w-full" />;
}

/**
 * Open in editor from the Changes panel (spec §6.13): a file of one
 * repository at a line, in that repository's project's editor; `line` null
 * is its first change.
 */
function useOpenChangedFile(workspace: Workspace, projects: Project[]) {
  const { run, dialog } = useOpenInEditor();
  const open = (
    repo: Pick<WorkspaceRepo, 'projectId' | 'primary'>,
    file: ChangedFile,
    group: ChangeGroup,
    line: number | null,
  ) => {
    const projectId = repo.primary ? null : repo.projectId;
    const project = projects.find((p) => p.id === repo.projectId);
    void run(
      async () => {
        const at =
          line ??
          (await trpcClient.changes.diff
            .query({
              workspaceId: workspace.id,
              projectId,
              group,
              path: file.path,
              oldPath: file.oldPath ?? null,
            })
            .then(diffFirstLine));
        return trpcClient.editor.openWorktree.mutate({
          workspaceId: workspace.id,
          projectId,
          file: file.path,
          line: at ?? undefined,
        });
      },
      {
        profileId: workspace.profileId,
        project: { id: repo.projectId, name: project?.name ?? repo.projectId },
      },
    );
  };
  return { open, dialog };
}

function FileRow({
  file,
  selected,
  onSelect,
  onOpen,
}: {
  file: ChangedFile;
  selected: boolean;
  onSelect: () => void;
  /** Open in editor at its first change; none for a deleted file. */
  onOpen?: () => void;
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        role="option"
        aria-selected={selected}
        data-change-file={file.path}
        title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        onClick={onSelect}
        className={`flex h-6.5 w-full items-center gap-2 rounded-sm px-2 font-mono text-sm ${
          selected ? 'bg-selected' : 'hover:bg-raised'
        }`}
      >
        <span className={`w-3 shrink-0 font-semibold ${KIND_COLOR[file.kind]}`}>{file.kind}</span>
        {/* Ellipsized from the left, so the file name stays visible. */}
        <span className="min-w-0 flex-1 truncate text-left [direction:rtl]">
          <bdi>{file.path}</bdi>
        </span>
        {file.binary ? (
          <span className="text-xs text-fg-subtle">bin</span>
        ) : (
          <>
            <span className="text-diff-add">{file.added ? `+${file.added}` : ''}</span>
            <span className="min-w-6 text-right text-diff-del">
              {file.removed ? `−${file.removed}` : ''}
            </span>
          </>
        )}
      </button>
      {onOpen && file.kind !== 'D' ? (
        <button
          type="button"
          data-open-file={file.path}
          title="Open in editor, at its first change"
          aria-label={`Open ${file.path} in editor`}
          className="absolute top-0.5 right-1 hidden h-5.5 rounded-sm border border-line-strong bg-raised px-1.5 text-xs text-fg-muted group-focus-within:block group-hover:block hover:text-fg"
          onClick={onOpen}
        >
          Open
        </button>
      ) : null}
    </div>
  );
}

export function PrBadge({ pr }: { pr: PrStatus }) {
  const tone =
    pr.state === 'merged' || pr.state === 'likely-merged'
      ? 'text-st-approval border-st-approval/40'
      : pr.state === 'closed'
        ? 'text-fg-subtle border-line'
        : 'text-diff-add border-diff-add/40';
  const label = PR_LABEL[pr.state];
  return pr.url ? (
    <button
      type="button"
      data-pr-badge={pr.state}
      title={`${pr.url} (${pr.source === 'git' ? 'from git' : 'from the PR status command'})`}
      onClick={() => void trpcClient.shell.openExternal.mutate({ url: pr.url ?? '' })}
      className={`rounded-sm border px-1.5 text-xs font-medium hover:bg-raised ${tone}`}
    >
      {label} ↗
    </button>
  ) : (
    <span
      data-pr-badge={pr.state}
      title={pr.source === 'git' ? 'From git: no PR status command is set' : undefined}
      className={`rounded-sm border px-1.5 text-xs font-medium ${tone}`}
    >
      {label}
    </span>
  );
}

/**
 * Commit → Push → Create PR → PR badge (spec §14.1), one step at a time.
 * Projects without a remote only commit.
 */
function FinishControls({ workspace }: { workspace: Workspace }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const state = useQuery(
    trpc.changes.state.queryOptions(
      { workspaceId: workspace.id },
      { refetchInterval: 3000, staleTime: 0 },
    ),
  );
  const refresh = () => void queryClient.invalidateQueries({ queryKey: trpc.changes.pathKey() });
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const done = (text: string | null) => () => {
    setNote(text);
    refresh();
  };
  const commit = useMutation(
    trpc.changes.commit.mutationOptions({
      onSuccess: () => {
        setMessage(null);
        refresh();
      },
    }),
  );
  const ask = useMutation(
    trpc.changes.askClaudeToCommit.mutationOptions({
      onSuccess: done('Sent to Claude: it writes the message and commits.'),
    }),
  );
  const push = useMutation(trpc.changes.push.mutationOptions({ onSuccess: done(null) }));
  const createPr = useMutation(
    trpc.changes.createPr.mutationOptions({
      onSuccess: (result) => {
        if (result.via === 'claude') setNote('Sent to Claude: it opens the pull request.');
        else if (result.result.ok)
          setNote(commandOutput(result.result.output) || 'Create PR finished.');
        else setNote(null);
        refresh();
      },
    }),
  );
  const check = useMutation(trpc.changes.refreshPr.mutationOptions({ onSuccess: refresh }));
  const s = state.data;
  if (!s) return null;
  const busy = commit.isPending || push.isPending || createPr.isPending || ask.isPending;
  const failed =
    createPr.data?.via === 'command' && !createPr.data.result.ok
      ? `${createPr.data.result.message}\n${createPr.data.result.output}`
      : null;
  const error =
    (commit.error ?? ask.error ?? push.error ?? createPr.error ?? check.error)?.message ?? failed;

  return (
    <div data-finish className="shrink-0 space-y-2 border-t border-line bg-surface p-3 text-md">
      {s.uncommitted > 0 ? (
        <>
          <textarea
            aria-label="Commit message"
            className={`${inputClass} h-auto min-h-14 py-1.5 text-sm`}
            spellCheck={false}
            value={message ?? s.commitMessage}
            onChange={(e) => setMessage(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={button('primary', 'sm')}
              disabled={busy || !(message ?? s.commitMessage).trim()}
              onClick={() =>
                commit.mutate({ workspaceId: workspace.id, message: message ?? s.commitMessage })
              }
            >
              Commit {s.uncommitted} {s.uncommitted === 1 ? 'file' : 'files'}
            </button>
            <button
              type="button"
              className={button('ghost', 'sm')}
              disabled={busy}
              onClick={() => ask.mutate({ workspaceId: workspace.id })}
            >
              Ask Claude to write it
            </button>
          </div>
        </>
      ) : null}
      {s.hasRemote && s.uncommitted === 0 && s.unpushed > 0 ? (
        <button
          type="button"
          className={button('primary', 'sm')}
          disabled={busy}
          onClick={() => push.mutate({ workspaceId: workspace.id })}
        >
          {push.isPending
            ? 'Pushing…'
            : `Push ${s.unpushed} ${s.unpushed === 1 ? 'commit' : 'commits'} to ${s.remote}`}
        </button>
      ) : null}
      {s.hasRemote && s.uncommitted === 0 && s.unpushed === 0 && s.pushed && !s.pr ? (
        <button
          type="button"
          className={button('primary', 'sm')}
          disabled={busy}
          title={
            s.createsWithCommand
              ? 'Runs the PR create command in the worktree'
              : 'Sends the create prompt to the Claude tab'
          }
          onClick={() => createPr.mutate({ workspaceId: workspace.id })}
        >
          {createPr.isPending
            ? 'Creating…'
            : s.createsWithCommand
              ? 'Create PR'
              : 'Create PR with Claude'}
        </button>
      ) : null}
      {s.hasRemote && (s.pr || s.pushed) ? (
        <div className="flex items-center gap-2 text-sm">
          {s.pr ? <PrBadge pr={s.pr} /> : <span className="text-fg-subtle">No PR known</span>}
          <button
            type="button"
            className="text-fg-muted underline-offset-2 hover:text-fg hover:underline"
            disabled={check.isPending}
            onClick={() => check.mutate({ workspaceId: workspace.id })}
          >
            {check.isPending ? 'Checking…' : 'Check again'}
          </button>
        </div>
      ) : null}
      {!s.hasRemote ? (
        <p className="text-sm text-fg-subtle">No remote: Push and Create PR aren't available.</p>
      ) : null}
      {s.uncommitted === 0 && s.unpushed === 0 && !s.pushed && s.hasRemote ? (
        <p className="text-sm text-fg-subtle">Nothing to commit or push yet.</p>
      ) : null}
      {note ? (
        <p className="text-sm whitespace-pre-wrap text-fg-muted select-text">{note}</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm whitespace-pre-wrap text-st-error select-text">
          ✕ {error}
        </p>
      ) : null}
    </div>
  );
}

/** A repository's query input: the main one keeps the plain workspace key. */
const repoInput = (workspaceId: string, repo: WorkspaceRepo) =>
  repo.primary ? { workspaceId } : { workspaceId, projectId: repo.projectId };

/** "PR #318 · open" from a PR's URL and state (components.md, linked sections). */
function prLabel(pr: PrStatus): string {
  const number = pr.url?.match(/(\d+)\/?$/)?.[1];
  return number ? `PR #${number} · ${PR_LABEL[pr.state].replace(/^PR /, '')}` : PR_LABEL[pr.state];
}

/**
 * One repository's commit message (prefilled, editable, or written by Claude
 * for that repository only) and Commit n → Push ↑n → Create PR (View PR #n
 * once known), each enabled only when it has something to do (spec §21.5).
 */
function RepoControls({
  workspace,
  repo,
  name,
}: {
  workspace: Workspace;
  repo: WorkspaceRepo;
  /** The repository's project name. */
  name: string;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const input = repoInput(workspace.id, repo);
  const state = useQuery(
    trpc.changes.state.queryOptions(input, { refetchInterval: 3000, staleTime: 0 }),
  );
  const refresh = () => void queryClient.invalidateQueries({ queryKey: trpc.changes.pathKey() });
  const [note, setNote] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const commit = useMutation(
    trpc.changes.commit.mutationOptions({
      onSuccess: () => {
        setMessage(null);
        refresh();
      },
    }),
  );
  const ask = useMutation(
    trpc.changes.askClaudeToCommit.mutationOptions({
      onSuccess: () => {
        setNote('Sent to Claude: it writes the message and commits in this repository.');
        refresh();
      },
    }),
  );
  const push = useMutation(trpc.changes.push.mutationOptions({ onSuccess: refresh }));
  const createPr = useMutation(
    trpc.changes.createPr.mutationOptions({
      onSuccess: (result) => {
        if (result.via === 'claude') setNote('Sent to Claude: it opens the pull request.');
        else
          setNote(
            result.result.ok ? commandOutput(result.result.output) || 'Create PR finished.' : null,
          );
        refresh();
      },
    }),
  );
  const s = state.data;
  if (!s) return null;
  const busy = commit.isPending || push.isPending || createPr.isPending || ask.isPending;
  const failed =
    createPr.data?.via === 'command' && !createPr.data.result.ok
      ? `${createPr.data.result.message}\n${createPr.data.result.output}`
      : null;
  const error = (commit.error ?? ask.error ?? push.error ?? createPr.error)?.message ?? failed;
  const arrow = <span className="text-fg-subtle">→</span>;
  const pr = s.pr;
  const text = message ?? s.commitMessage;
  return (
    <div data-repo-controls={repo.projectId} className="space-y-1.5 px-2 pt-1 pb-2">
      {s.uncommitted > 0 ? (
        <>
          <textarea
            aria-label={`Commit message for ${name}`}
            className={`${inputClass} h-auto min-h-14 py-1.5 text-sm`}
            spellCheck={false}
            value={text}
            onChange={(e) => setMessage(e.target.value)}
          />
          <button
            type="button"
            className={button('ghost', 'sm')}
            disabled={busy}
            title={`Claude writes the message and commits in ${name} only`}
            onClick={() => ask.mutate(input)}
          >
            Ask Claude to write it
          </button>
        </>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={button('secondary', 'sm')}
          disabled={busy || s.uncommitted === 0 || !text.trim()}
          title={s.uncommitted === 0 ? 'Nothing to commit' : undefined}
          onClick={() => commit.mutate({ ...input, message: text })}
        >
          Commit {s.uncommitted}
        </button>
        {s.hasRemote ? (
          <>
            {arrow}
            <button
              type="button"
              className={button('secondary', 'sm')}
              disabled={busy || s.unpushed === 0 || s.uncommitted > 0}
              title={
                s.uncommitted > 0
                  ? 'Commit first'
                  : s.unpushed === 0
                    ? 'Nothing to push'
                    : `Push to ${s.remote}`
              }
              onClick={() => push.mutate(input)}
            >
              {push.isPending ? 'Pushing…' : `Push ↑${s.unpushed}`}
            </button>
            {arrow}
            {pr?.url ? (
              <button
                type="button"
                className={button('secondary', 'sm')}
                onClick={() => void trpcClient.shell.openExternal.mutate({ url: pr.url ?? '' })}
              >
                View {prLabel(pr).split(' · ')[0]}
              </button>
            ) : (
              <button
                type="button"
                className={button('secondary', 'sm')}
                disabled={busy || !s.pushed || s.unpushed > 0 || s.uncommitted > 0 || Boolean(pr)}
                title={
                  pr
                    ? 'A pull request is known'
                    : !s.pushed || s.unpushed > 0 || s.uncommitted > 0
                      ? 'Push first'
                      : s.createsWithCommand
                        ? 'Runs the PR create command in the worktree'
                        : 'Sends the create prompt to the Claude tab'
                }
                onClick={() => createPr.mutate(input)}
              >
                {createPr.isPending ? 'Creating…' : 'Create PR'}
              </button>
            )}
          </>
        ) : null}
      </div>
      {note ? (
        <p className="text-sm whitespace-pre-wrap text-fg-muted select-text">{note}</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm whitespace-pre-wrap text-st-error select-text">
          ✕ {error}
        </p>
      ) : null}
    </div>
  );
}

const WIDTH_KEY = 'changes-panel-width';
const STYLE_KEY = 'changes-diff-style';
/** Its width beside the terminal (spec §6.4): from MIN_WIDTH to MAX_SHARE of the workspace area. */
const MIN_WIDTH = 360;
const MAX_SHARE = 0.75;
const defaultWidth = (narrow: boolean) => (narrow ? MIN_WIDTH : 380);
/** The diff's width side by side needs; below it the diff is unified, with a hint. */
const SPLIT_MIN_WIDTH = 640;

type DiffStyle = 'unified' | 'split';

/** Local storage may be unavailable (a private profile): the defaults apply then. */
function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // kept for this run only
  }
}

const storedStyle = (): DiffStyle => (stored(STYLE_KEY) === 'split' ? 'split' : 'unified');

/** Unified or Side by side: one setting for the whole app, kept across restarts (spec §6.4). */
function useDiffStyle(): [DiffStyle, (style: DiffStyle) => void] {
  const [style, setStyle] = useState<DiffStyle>(storedStyle);
  useEffect(() => {
    // Another window's panel changed it.
    const onStorage = (e: StorageEvent) => {
      if (e.key === STYLE_KEY) setStyle(storedStyle());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  return [
    style,
    (next) => {
      setStyle(next);
      store(STYLE_KEY, next);
    },
  ];
}

/** An element's width, followed as it changes. */
function useWidth(element: HTMLElement | null): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, [element]);
  return width;
}

/** The diff header's style switch, like a segmented control (components.md: Changes panel). */
function DiffStyleSwitch({
  style,
  onChange,
}: {
  style: DiffStyle;
  onChange: (style: DiffStyle) => void;
}) {
  const option = (value: DiffStyle, label: string, title: string) => (
    <button
      type="button"
      data-diff-style={value}
      aria-pressed={style === value}
      title={title}
      className={`h-5 rounded-sm px-1.5 text-xs whitespace-nowrap transition-colors duration-120 ease-out-quiet ${
        style === value ? 'bg-raised font-medium text-fg' : 'text-fg-muted hover:text-fg'
      }`}
      onClick={() => onChange(value)}
    >
      {label}
    </button>
  );
  return (
    <fieldset
      aria-label="Diff style"
      className="m-0 flex min-w-0 shrink-0 items-center gap-px rounded-md border border-line-strong p-px"
    >
      {option('unified', 'Unified', 'One column, removed lines above added ones')}
      {option('split', 'Side by side', 'The old version on the left, the new one on the right')}
    </fieldset>
  );
}

/**
 * The selected file's diff (spec §6.4): its header (path, Open in editor, the
 * style switch) and Monaco's diff. Side by side falls back to unified while
 * the diff is narrower than SPLIT_MIN_WIDTH, saying how to get room.
 */
function DiffPane({
  label,
  openButton,
  diff,
  path,
  cursorLine,
}: {
  label: ReactNode;
  openButton: ReactNode;
  /** The diff to show, once loaded for the selected file. */
  diff: FileDiff | null;
  path: string;
  cursorLine: { current: number | null };
}) {
  const [style, setStyle] = useDiffStyle();
  const [area, setArea] = useState<HTMLDivElement | null>(null);
  const width = useWidth(area);
  const tooNarrow = style === 'split' && width > 0 && width < SPLIT_MIN_WIDTH;
  return (
    <>
      <div className="flex h-[30px] shrink-0 items-center gap-2 border-b border-line px-3.5">
        {label}
        {openButton}
        <DiffStyleSwitch style={style} onChange={setStyle} />
      </div>
      {tooNarrow ? (
        <div
          data-split-fallback
          className="shrink-0 border-b border-line bg-surface px-3.5 py-1 text-xs text-fg-subtle"
        >
          Too narrow for side by side: widen the panel or use Full view (
          {keyHint('changesFullView')}).
        </div>
      ) : null}
      <div ref={setArea} data-diff-area className="min-h-0 flex-1 bg-term">
        {diff ? (
          <DiffView
            diff={diff}
            path={path}
            split={style === 'split' && !tooNarrow}
            cursorLine={cursorLine}
          />
        ) : null}
      </div>
    </>
  );
}

/** Full view and back, in the panel's header (like the Responses panel's). */
function FullViewButton({ full, onToggle }: { full: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      data-changes-full
      className={button('ghost', 'sm')}
      aria-pressed={full}
      title={
        full
          ? `Back to the side panel (Esc, ${keyHint('changesFullView')})`
          : `Over the whole workspace (${keyHint('changesFullView')})`
      }
      onClick={onToggle}
    >
      {full ? 'Side panel' : 'Full view'}
    </button>
  );
}

/**
 * The panel's frame (spec §6.4): beside the terminal its left edge drags to
 * resize it (double-click resets it), the width kept across restarts; in
 * Full view it takes the whole workspace area. Esc leaves Full view first.
 */
function ChangesFrame({
  narrow,
  full,
  onToggleFull,
  onKeyDown,
  children,
}: {
  narrow: boolean;
  full: boolean;
  onToggleFull: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
  children: ReactNode;
}) {
  const asideRef = useRef<HTMLElement>(null);
  // In focus when it changes size, so Esc reaches it (the terminal may be hidden).
  const sized = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when full view changes
  useEffect(() => {
    if (sized.current) asideRef.current?.focus();
    sized.current = true;
  }, [full]);
  const saved = Number(stored(WIDTH_KEY));
  const [width, setWidth] = useState(() =>
    Number.isFinite(saved) && saved >= MIN_WIDTH ? saved : defaultWidth(narrow),
  );
  const [area, setArea] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setArea(asideRef.current?.parentElement ?? null), []);
  const areaWidth = useWidth(area);
  const clamp = (value: number) =>
    Math.max(MIN_WIDTH, Math.min(value, areaWidth > 0 ? areaWidth * MAX_SHARE : value));
  const shown = clamp(width);
  // The drag's latest width, saved on release (the render may not have caught up yet).
  const drag = useRef<{ x: number; width: number; now: number } | null>(null);
  const onDragStart = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, width: shown, now: shown };
  };
  const onDragMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current.now = clamp(drag.current.width + drag.current.x - event.clientX);
    setWidth(drag.current.now);
  };
  const onDragEnd = () => {
    if (!drag.current) return;
    store(WIDTH_KEY, String(Math.round(drag.current.now)));
    drag.current = null;
  };
  const reset = () => {
    store(WIDTH_KEY, null);
    setWidth(defaultWidth(narrow));
  };
  return (
    <aside
      ref={asideRef}
      data-changes-panel
      data-full={full ? 'true' : 'false'}
      aria-label="Changes"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && full) {
          e.preventDefault();
          e.stopPropagation();
          onToggleFull();
          return;
        }
        onKeyDown(e);
      }}
      style={full ? undefined : { width: shown }}
      className={`relative flex min-h-0 flex-col bg-canvas outline-none ${full ? 'min-w-0 flex-1' : 'shrink-0 border-l border-line'}`}
    >
      {full ? null : (
        // biome-ignore lint/a11y/noStaticElementInteractions: a pointer-only drag edge; Full view is the keyboard's way to more room
        <div
          data-changes-resize
          title="Drag to resize; double-click for the default width"
          className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-line-strong/60"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          onDoubleClick={reset}
        />
      )}
      {children}
    </aside>
  );
}

/**
 * The Changes panel of a linked workspace (spec §21.5): one collapsible
 * section per repository, main first, each with its groups, PR badge and
 * its own Commit → Push → Create PR. ↑↓ move across sections.
 */
function LinkedChangesPanel({
  workspace,
  projects,
  onClose,
  narrow,
  full,
  onToggleFull,
  focus,
}: {
  workspace: Workspace;
  projects: Project[];
  onClose: () => void;
  narrow: boolean;
  full: boolean;
  onToggleFull: () => void;
  focus?: ChangesFocus | null;
}) {
  const trpc = useTRPC();
  const repos = workspace.repos;
  const name = (id: string) => projects.find((p) => p.id === id)?.name ?? id;
  const lists = useQueries({
    queries: repos.map((r) =>
      trpc.changes.list.queryOptions(repoInput(workspace.id, r), {
        refetchInterval: 3000,
        staleTime: 0,
      }),
    ),
  });
  const states = useQueries({
    queries: repos.map((r) =>
      trpc.changes.state.queryOptions(repoInput(workspace.id, r), {
        refetchInterval: 3000,
        staleTime: 0,
      }),
    ),
  });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // Show in Changes (a repository chip, spec §21.4): that section expanded, scrolled to.
  useEffect(() => {
    if (!focus) return;
    setCollapsed((c) => ({ ...c, [focus.projectId]: false }));
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-changes-repo="${CSS.escape(focus.projectId)}"]`)
        ?.scrollIntoView({ block: 'start' }),
    );
  }, [focus]);
  const [selected, setSelected] = useState<{
    projectId: string;
    group: ChangeGroup;
    path: string;
  } | null>(null);
  const rows = repos.flatMap((repo, i) =>
    collapsed[repo.projectId]
      ? []
      : [
          ...(lists[i]?.data?.committed ?? []).map((file) => ({
            repo,
            group: 'committed' as const,
            file,
          })),
          ...(lists[i]?.data?.uncommitted ?? []).map((file) => ({
            repo,
            group: 'uncommitted' as const,
            file,
          })),
        ],
  );
  const same = (r: (typeof rows)[number], s: typeof selected) =>
    s !== null && r.repo.projectId === s.projectId && r.group === s.group && r.file.path === s.path;
  const current = rows.find((r) => same(r, selected)) ?? rows[0] ?? null;
  const diff = useQuery(
    trpc.changes.diff.queryOptions(
      {
        workspaceId: workspace.id,
        projectId: current && !current.repo.primary ? current.repo.projectId : null,
        group: current?.group ?? 'uncommitted',
        path: current?.file.path ?? '-',
        oldPath: current?.file.oldPath ?? null,
      },
      { enabled: current !== null, staleTime: 0, refetchInterval: 3000 },
    ),
  );
  const keyOf = (r: (typeof rows)[number]) => `${r.repo.projectId}:${r.group}:${r.file.path}:`;
  const shown = useRef<{ key: string; diff: FileDiff } | null>(null);
  const cursorLine = useRef<number | null>(null);
  const editorOpen = useOpenChangedFile(workspace, projects);
  if (diff.data && current) {
    const key = `${keyOf(current)}${JSON.stringify(diff.data)}`;
    if (shown.current?.key !== key) shown.current = { key, diff: diff.data };
  }
  const added = lists.reduce((n, l) => n + (l.data?.added ?? 0), 0);
  const removed = lists.reduce((n, l) => n + (l.data?.removed ?? 0), 0);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      document.querySelector<HTMLElement>('[data-terminal] .xterm-helper-textarea')?.focus();
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const at = current ? rows.indexOf(current) : -1;
    const next =
      rows[Math.min(rows.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next)
      setSelected({ projectId: next.repo.projectId, group: next.group, path: next.file.path });
  };

  return (
    <ChangesFrame narrow={narrow} full={full} onToggleFull={onToggleFull} onKeyDown={onKeyDown}>
      <div className="flex h-[34px] shrink-0 items-center gap-2 border-b border-line bg-surface pr-2 pl-3.5">
        <span className="text-md font-semibold">Changes</span>
        <span className="truncate text-xs text-fg-subtle">· {repos.length} repositories</span>
        <span className="flex-1" />
        <span className="font-mono text-xs font-medium text-diff-add">+{added}</span>
        <span className="font-mono text-xs font-medium text-diff-del">−{removed}</span>
        <FullViewButton full={full} onToggle={onToggleFull} />
        <button
          type="button"
          className={iconButton}
          title={`Close ${keyHint('changes')}`}
          aria-label="Close changes"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div
        role="listbox"
        aria-label="Changed files"
        tabIndex={0}
        className="max-h-[55%] shrink-0 overflow-y-auto border-b border-line outline-none"
      >
        {repos.map((repo, i) => {
          const data = lists[i]?.data;
          const state = states[i]?.data;
          const open = !collapsed[repo.projectId];
          const group = (g: ChangeGroup, label: string, files: ChangedFile[], right?: string) =>
            files.length > 0 ? (
              <div>
                <div className="flex h-6 items-center px-2 text-xs font-semibold text-fg-subtle">
                  {label} {files.length}
                  <span className="flex-1" />
                  {right ? <span className="font-normal">{right}</span> : null}
                </div>
                {files.map((file) => (
                  <FileRow
                    key={`${g}:${file.path}`}
                    file={file}
                    selected={
                      current?.repo.projectId === repo.projectId &&
                      current.group === g &&
                      current.file.path === file.path
                    }
                    onSelect={() =>
                      setSelected({ projectId: repo.projectId, group: g, path: file.path })
                    }
                    onOpen={() => editorOpen.open(repo, file, g, null)}
                  />
                ))}
              </div>
            ) : null;
          return (
            <section key={repo.projectId} data-changes-repo={repo.projectId}>
              <div className="flex h-8 items-center gap-2 border-b border-line bg-surface px-2">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-label={
                    open ? `Collapse ${name(repo.projectId)}` : `Expand ${name(repo.projectId)}`
                  }
                  className="w-3 text-[9px] text-fg-muted"
                  onClick={() => setCollapsed((c) => ({ ...c, [repo.projectId]: open }))}
                >
                  {open ? '▼' : '▶'}
                </button>
                <span className="font-mono text-sm">{name(repo.projectId)}</span>
                {repo.primary ? <PrimaryTag /> : null}
                {state?.pr ? (
                  <button
                    type="button"
                    data-pr-badge={state.pr.state}
                    disabled={!state.pr.url}
                    onClick={() =>
                      void trpcClient.shell.openExternal.mutate({ url: state.pr?.url ?? '' })
                    }
                    className="h-[18px] rounded-full border border-diff-add/50 px-1.5 font-mono text-2xs text-diff-add"
                  >
                    {prLabel(state.pr)}
                  </button>
                ) : null}
                <span className="flex-1" />
                {data ? (
                  <>
                    <span className="font-mono text-xs text-diff-add">+{data.added}</span>
                    <span className="font-mono text-xs text-diff-del">−{data.removed}</span>
                  </>
                ) : null}
              </div>
              {open ? (
                <div className="p-1">
                  {lists[i]?.error ? (
                    <p role="alert" className="px-2 text-sm text-st-error select-text">
                      ✕ {lists[i]?.error?.message}
                    </p>
                  ) : null}
                  {data && data.committed.length + data.uncommitted.length === 0 ? (
                    <p className="px-2 py-1 text-sm text-fg-subtle">No changes yet</p>
                  ) : null}
                  {group(
                    'committed',
                    'Committed',
                    data?.committed ?? [],
                    state?.hasRemote
                      ? state.unpushed > 0
                        ? `↑${state.unpushed} not pushed`
                        : state.pushed
                          ? 'pushed'
                          : undefined
                      : undefined,
                  )}
                  {group('uncommitted', 'Uncommitted', data?.uncommitted ?? [])}
                  <RepoControls workspace={workspace} repo={repo} name={name(repo.projectId)} />
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
      {current ? (
        <DiffPane
          label={
            <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium text-fg-muted">
              {name(current.repo.projectId)} · {current.file.path}
            </span>
          }
          openButton={
            current.file.kind !== 'D' ? (
              <button
                type="button"
                data-open-diff
                className={button('ghost', 'sm')}
                title="Open in editor, at the line of the cursor in the diff, else the first change"
                onClick={() =>
                  editorOpen.open(
                    current.repo,
                    current.file,
                    current.group,
                    cursorLine.current ??
                      (shown.current?.key.startsWith(keyOf(current))
                        ? diffFirstLine(shown.current.diff)
                        : null),
                  )
                }
              >
                Open in editor
              </button>
            ) : null
          }
          diff={shown.current?.key.startsWith(keyOf(current)) ? shown.current.diff : null}
          path={current.file.path}
          cursorLine={cursorLine}
        />
      ) : (
        <div className="flex-1" />
      )}
      {editorOpen.dialog}
    </ChangesFrame>
  );
}

/**
 * The Changes panel (spec §6.4, components.md): what the workspace changed
 * against its base, committed since the merge base and uncommitted, with a
 * read-only diff and the finish controls. ⌘⇧D toggles it; Esc returns to the
 * terminal. A linked workspace gets a section per repository (§21.5).
 */
/** A repository whose section the linked Changes panel shows; `at` repeats the request. */
export interface ChangesFocus {
  projectId: string;
  at: number;
}

export function ChangesPanel({
  workspace,
  projects = [],
  onClose,
  narrow,
  full,
  onToggleFull,
  focus = null,
}: {
  workspace: Workspace;
  projects?: Project[];
  onClose: () => void;
  narrow: boolean;
  /** It fills the workspace area, the terminal hidden (⇧⌘M). */
  full: boolean;
  onToggleFull: () => void;
  focus?: ChangesFocus | null;
}) {
  if (workspace.repos.length > 1) {
    return (
      <LinkedChangesPanel
        workspace={workspace}
        projects={projects}
        onClose={onClose}
        narrow={narrow}
        full={full}
        onToggleFull={onToggleFull}
        focus={focus}
      />
    );
  }
  return (
    <SingleChangesPanel
      workspace={workspace}
      projects={projects}
      onClose={onClose}
      narrow={narrow}
      full={full}
      onToggleFull={onToggleFull}
    />
  );
}

function SingleChangesPanel({
  workspace,
  projects,
  onClose,
  narrow,
  full,
  onToggleFull,
}: {
  workspace: Workspace;
  projects: Project[];
  onClose: () => void;
  narrow: boolean;
  full: boolean;
  onToggleFull: () => void;
}) {
  const trpc = useTRPC();
  const changes = useQuery(
    trpc.changes.list.queryOptions(
      { workspaceId: workspace.id },
      { refetchInterval: 3000, staleTime: 0 },
    ),
  );
  const [selected, setSelected] = useState<{ group: ChangeGroup; path: string } | null>(null);
  const data = changes.data;
  const rows: { group: ChangeGroup; file: ChangedFile }[] = [
    ...(data?.committed ?? []).map((file) => ({ group: 'committed' as const, file })),
    ...(data?.uncommitted ?? []).map((file) => ({ group: 'uncommitted' as const, file })),
  ];
  const current =
    rows.find((r) => r.group === selected?.group && r.file.path === selected.path) ??
    rows[0] ??
    null;
  const diff = useQuery(
    trpc.changes.diff.queryOptions(
      {
        workspaceId: workspace.id,
        group: current?.group ?? 'uncommitted',
        path: current?.file.path ?? '-',
        oldPath: current?.file.oldPath ?? null,
      },
      { enabled: current !== null, staleTime: 0, refetchInterval: 3000 },
    ),
  );
  // Keep the editor when a refetch brings the same content.
  const shown = useRef<{ key: string; diff: FileDiff } | null>(null);
  const cursorLine = useRef<number | null>(null);
  const editorOpen = useOpenChangedFile(workspace, projects);
  const mainRepo = { projectId: workspace.projectId, primary: true };
  if (diff.data && current) {
    const key = `${current.group}:${current.file.path}:${JSON.stringify(diff.data)}`;
    if (shown.current?.key !== key) shown.current = { key, diff: diff.data };
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      document.querySelector<HTMLElement>('[data-terminal] .xterm-helper-textarea')?.focus();
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const at = current ? rows.indexOf(current) : -1;
    const next =
      rows[Math.min(rows.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) setSelected({ group: next.group, path: next.file.path });
  };

  const group = (name: ChangeGroup, label: string, files: ChangedFile[]) =>
    files.length > 0 ? (
      <div>
        <div className="px-2 pt-1 pb-0.5 text-xs text-fg-subtle">
          {label} · {files.length}
        </div>
        {files.map((file) => (
          <FileRow
            key={`${name}:${file.path}`}
            file={file}
            selected={current?.group === name && current.file.path === file.path}
            onSelect={() => setSelected({ group: name, path: file.path })}
            onOpen={() => editorOpen.open(mainRepo, file, name, null)}
          />
        ))}
      </div>
    ) : null;

  return (
    <ChangesFrame narrow={narrow} full={full} onToggleFull={onToggleFull} onKeyDown={onKeyDown}>
      <div className="flex h-[34px] shrink-0 items-center gap-2 border-b border-line bg-surface pr-2 pl-3.5">
        <span className="text-md font-semibold">Changes</span>
        <span className="truncate font-mono text-xs text-fg-subtle">vs {data?.base ?? '…'}</span>
        <span className="flex-1" />
        {data ? (
          <>
            <span className="font-mono text-xs font-medium text-diff-add">+{data.added}</span>
            <span className="font-mono text-xs font-medium text-diff-del">−{data.removed}</span>
          </>
        ) : null}
        <FullViewButton full={full} onToggle={onToggleFull} />
        <button
          type="button"
          className={iconButton}
          title={`Close ${keyHint('changes')}`}
          aria-label="Close changes"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {changes.error ? (
        <p role="alert" className="p-3 text-sm text-st-error select-text">
          ✕ {changes.error.message}
        </p>
      ) : null}
      {data && rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 p-6 text-center">
          <div className="font-medium">No changes yet</div>
          <div className="max-w-[220px] text-sm text-fg-subtle">
            Files that differ from {data.base} appear here as Claude edits the worktree.
          </div>
        </div>
      ) : null}
      {rows.length > 0 ? (
        <>
          <div
            role="listbox"
            aria-label="Changed files"
            tabIndex={0}
            className="max-h-[38%] shrink-0 overflow-y-auto border-b border-line p-1.5 outline-none"
          >
            {group('committed', 'Committed', data?.committed ?? [])}
            {group('uncommitted', 'Uncommitted', data?.uncommitted ?? [])}
          </div>
          <DiffPane
            label={
              <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium text-fg-muted [direction:rtl]">
                <bdi>{current?.file.path}</bdi>
              </span>
            }
            openButton={
              current && current.file.kind !== 'D' ? (
                <button
                  type="button"
                  data-open-diff
                  className={button('ghost', 'sm')}
                  title="Open in editor, at the line of the cursor in the diff, else the first change"
                  onClick={() =>
                    editorOpen.open(
                      mainRepo,
                      current.file,
                      current.group,
                      cursorLine.current ??
                        (shown.current?.key.startsWith(`${current.group}:${current.file.path}:`)
                          ? diffFirstLine(shown.current.diff)
                          : null),
                    )
                  }
                >
                  Open in editor
                </button>
              ) : null
            }
            diff={
              shown.current &&
              current &&
              shown.current.key.startsWith(`${current.group}:${current.file.path}:`)
                ? shown.current.diff
                : null
            }
            path={current?.file.path ?? ''}
            cursorLine={cursorLine}
          />
        </>
      ) : (
        <div className="flex-1" />
      )}
      <FinishControls workspace={workspace} />
      {editorOpen.dialog}
    </ChangesFrame>
  );
}
