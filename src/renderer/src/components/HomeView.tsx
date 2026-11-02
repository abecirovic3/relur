import type { Profile, Project } from '@shared/schemas';
import { GLYPH_LABEL, glyphFor, needsYou } from '@shared/status';
import type { SessionInfo } from '@shared/terminal-protocol';
import { UNFINISHED_TOOLTIP, workspaceGlyph } from '@shared/unfinished';
import type { Workspace } from '@shared/workspaces';
import { useMutation } from '@tanstack/react-query';
import { type ReactNode, useEffect } from 'react';
import { useTRPC } from '../trpc';
import { button, Kbd, keyHint } from '../ui/controls';
import { useLaunching } from '../ui/launching';
import { StatusGlyph } from '../ui/StatusGlyph';
import { ago } from '../ui/time';
import { TerminalView } from './TerminalView';

const STATE_TEXT: Partial<Record<Workspace['state'], string>> = {
  'needs-permission': 'text-st-permission',
  'needs-input': 'text-st-input',
  'awaiting-approval': 'text-st-approval',
};

/** Most recently active first. */
function byActivity(a: Workspace, b: Workspace): number {
  return (b.lastActivityAt ?? b.createdAt).localeCompare(a.lastActivityAt ?? a.createdAt);
}

/**
 * The profile's home terminal (spec §6.7) with its overlay, in one of three
 * states: what needs you, quick actions with recent workspaces, or getting
 * started when the profile has no projects. The overlay never takes focus:
 * its buttons are out of the tab order and keep the mouse from moving focus,
 * so typing always reaches the terminal.
 */
export function HomeView({
  profile,
  session,
  projects,
  workspaces,
  collapsed,
  onToggleCollapsed,
  onAddProject,
  onNewWorkspace,
  onOpenWorkspace,
  startClaude,
}: {
  profile: Profile;
  session: SessionInfo | null;
  projects: Project[];
  /** The profile's workspaces. */
  workspaces: Workspace[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onAddProject: () => void;
  onNewWorkspace: (() => void) | null;
  onOpenWorkspace: (workspace: Workspace) => void;
  /** Start Claude here, owned by the app so ⌘L shares its error. */
  startClaude: { run: () => void; error: string | null; pending: boolean };
}) {
  const trpc = useTRPC();
  const homeShell = useMutation(trpc.sessions.homeShell.mutationOptions());
  const restart = useMutation(trpc.sessions.restartHomeShell.mutationOptions());
  const { mutate: ensureHomeShell } = homeShell;

  // Every profile has a home shell; the main process starts it once.
  useEffect(() => ensureHomeShell({ profileId: profile.id }), [profile.id, ensureHomeShell]);

  const configDir = profile.env.CLAUDE_CONFIG_DIR;
  const error = (homeShell.error ?? restart.error)?.message ?? startClaude.error;
  // Oldest first (components.md, Home overlay); Unfinished ones too (spec §9.7).
  const since = (w: Workspace) => (needsYou(w.state) ? w.stateSince : w.unfinished?.since) ?? '';
  const needs = workspaces
    .filter((w) => needsYou(w.state) || w.unfinished)
    .sort((a, b) => since(a).localeCompare(since(b)));
  const mode = projects.length === 0 ? 'empty' : needs.length > 0 ? 'needs' : 'calm';

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-term">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-surface px-3.5">
        <span className="font-semibold">Home</span>
        <span className="truncate font-mono text-sm text-fg-muted">
          ~{configDir ? ` · CLAUDE_CONFIG_DIR=${configDir}` : ''}
        </span>
        {collapsed ? (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={keepFocus}
            onClick={onToggleCollapsed}
            className="ml-auto inline-flex h-[26px] items-center gap-2 rounded-full border border-line-strong bg-raised px-2.5 text-sm text-fg-muted hover:text-fg"
          >
            {needs.length > 0 ? (
              <>
                Needs you <CountBadge count={needs.length} />
              </>
            ) : (
              'Quick actions'
            )}
            <Kbd>{keyHint('homePanel')}</Kbd>
          </button>
        ) : null}
      </div>

      {session?.status === 'exited' ? (
        <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2 text-md">
          <span className="text-fg-muted">The home shell has exited.</span>
          <button
            type="button"
            className={button('secondary', 'sm')}
            disabled={restart.isPending}
            onClick={() => restart.mutate({ profileId: profile.id })}
          >
            Start again
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="px-4 py-2 text-md text-st-error select-text">
          ✕ {error}
        </p>
      ) : null}

      <div className="min-h-0 flex-1">
        {session ? <TerminalView key={session.id} sessionId={session.id} /> : null}
      </div>

      {collapsed ? null : (
        <section
          aria-label="Home panel"
          className="absolute top-[46px] right-4 z-10 w-[300px] rounded-lg border border-line-strong bg-raised shadow-overlay"
        >
          <header className="flex h-[34px] items-center gap-2 border-b border-line px-3">
            <span className="text-sm font-semibold">
              {{ needs: 'Needs you', calm: 'Quick actions', empty: 'Get started' }[mode]}
            </span>
            {mode === 'needs' ? <CountBadge count={needs.length} /> : null}
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={keepFocus}
              onClick={onToggleCollapsed}
              className="ml-auto flex items-center gap-1.5 rounded-sm px-1 text-sm text-fg-muted hover:text-fg"
            >
              Hide <Kbd>{keyHint('homePanel')}</Kbd>
            </button>
          </header>

          {mode === 'needs' ? (
            <>
              <div className="border-b border-line p-1">
                {needs.map((w) => (
                  <OverlayRow
                    key={w.id}
                    unfinished={!needsYou(w.state)}
                    onClick={() => onOpenWorkspace(w)}
                  >
                    <WorkspaceGlyph workspace={w} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-1.5">
                        {w.task.id ? (
                          <span className="font-mono text-xs text-fg-muted">{w.task.id}</span>
                        ) : null}
                        <span className="truncate">{w.task.title || w.name}</span>
                      </span>
                      {needsYou(w.state) ? (
                        <span className={`block truncate text-sm ${STATE_TEXT[w.state] ?? ''}`}>
                          {w.stateMessage ?? GLYPH_LABEL[glyphFor(w.state) ?? 'working']} ·{' '}
                          {projects.find((p) => p.id === w.projectId)?.name}
                        </span>
                      ) : (
                        <span className="block truncate text-sm text-st-input">
                          {UNFINISHED_TOOLTIP} · {projects.find((p) => p.id === w.projectId)?.name}
                        </span>
                      )}
                    </span>
                    <span className="font-mono text-xs text-fg-subtle">
                      {ago(
                        (needsYou(w.state) ? w.stateSince : w.unfinished?.since) ??
                          w.lastActivityAt,
                      )}
                    </span>
                  </OverlayRow>
                ))}
              </div>
              <div className="flex flex-wrap gap-x-1 border-b border-line p-1">
                <InlineAction
                  label="New workspace"
                  keys={keyHint('newWorkspace')}
                  onClick={onNewWorkspace}
                />
                <InlineAction
                  label="Add project"
                  keys={keyHint('addProject')}
                  onClick={onAddProject}
                />
                <InlineAction
                  label="Start Claude here"
                  keys={keyHint('startClaude')}
                  onClick={startClaude.pending ? null : startClaude.run}
                />
              </div>
            </>
          ) : null}

          {mode === 'calm' ? (
            <>
              <div className="border-b border-line p-1">
                <ActionRow
                  icon="+"
                  label="New workspace"
                  keys={keyHint('newWorkspace')}
                  onClick={onNewWorkspace}
                />
                <ActionRow
                  icon="⌁"
                  label="Add project"
                  keys={keyHint('addProject')}
                  onClick={onAddProject}
                />
                <ActionRow
                  icon="›"
                  label="Start Claude here"
                  keys={keyHint('startClaude')}
                  onClick={startClaude.pending ? null : startClaude.run}
                />
              </div>
              {workspaces.length > 0 ? (
                <div className="border-b border-line p-1">
                  <div className="px-2 pt-1.5 pb-1 text-xs font-semibold tracking-wider text-fg-subtle uppercase">
                    Recent workspaces
                  </div>
                  {[...workspaces]
                    .sort(byActivity)
                    .slice(0, 4)
                    .map((w) => (
                      <OverlayRow key={w.id} onClick={() => onOpenWorkspace(w)}>
                        <WorkspaceGlyph workspace={w} />
                        {w.task.id ? (
                          <span className="font-mono text-xs text-fg-muted">{w.task.id}</span>
                        ) : null}
                        <span className="min-w-0 flex-1 truncate">{w.task.title || w.name}</span>
                        <span className="font-mono text-xs text-fg-subtle">
                          {ago(w.lastActivityAt ?? w.createdAt)}
                        </span>
                      </OverlayRow>
                    ))}
                </div>
              ) : null}
            </>
          ) : null}

          {mode === 'empty' ? (
            <div className="border-b border-line p-3">
              <ol className="space-y-3">
                {[
                  ['Add project', 'Pick a git repository on disk.'],
                  ['New workspace', 'One task gets its own worktree, branch and terminals.'],
                  ['Claude starts in the workspace', 'With the task, in its own worktree.'],
                ].map(([title, text], index) => (
                  <li key={title} className="flex gap-2.5">
                    <span
                      className={`flex size-5 shrink-0 items-center justify-center rounded-full border text-xs ${
                        index === 0
                          ? 'border-fg bg-fg font-semibold text-on-fg'
                          : 'border-line-strong text-fg-muted'
                      }`}
                    >
                      {index + 1}
                    </span>
                    <span>
                      <span className="block font-semibold">{title}</span>
                      <span className="block text-sm text-fg-muted">{text}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mt-3 flex items-center gap-1">
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={keepFocus}
                  onClick={onAddProject}
                  className={button('primary', 'md')}
                >
                  Add project <Kbd onFg>{keyHint('addProject')}</Kbd>
                </button>
                <InlineAction
                  label="Start Claude here"
                  keys={keyHint('startClaude')}
                  onClick={startClaude.pending ? null : startClaude.run}
                />
              </div>
            </div>
          ) : null}

          <p className="px-3 py-2 text-sm text-fg-subtle">
            Keys go to the terminal. {keyHint('homePanel')} hides this panel.
          </p>
        </section>
      )}
    </div>
  );
}

function CountBadge({ count }: { count: number }) {
  return (
    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-st-permission px-1 font-mono text-2xs font-semibold text-on-fg">
      {count}
    </span>
  );
}

function WorkspaceGlyph({ workspace }: { workspace: Workspace }) {
  const launching = useLaunching();
  const glyph = workspaceGlyph(workspace, launching.has(workspace.id));
  return glyph ? <StatusGlyph glyph={glyph} /> : <span className="size-3 flex-none" />;
}

const keepFocus = (e: React.MouseEvent) => e.preventDefault();

function OverlayRow({
  onClick,
  unfinished,
  children,
}: {
  onClick: () => void;
  /** An Unfinished workspace's row (spec §9.7). */
  unfinished?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-needs-unfinished={unfinished || undefined}
      tabIndex={-1}
      onMouseDown={keepFocus}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-base hover:bg-selected"
    >
      {children}
    </button>
  );
}

function ActionRow({
  icon,
  label,
  keys,
  onClick,
}: {
  icon: string;
  label: string;
  keys: string;
  onClick: (() => void) | null;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onMouseDown={keepFocus}
      disabled={!onClick}
      onClick={onClick ?? undefined}
      className="flex h-[31px] w-full items-center gap-3 rounded-md px-2.5 text-left text-base hover:bg-selected disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <span className="w-3 text-fg-muted">{icon}</span>
      <span className="flex-1">{label}</span>
      <Kbd>{keys}</Kbd>
    </button>
  );
}

function InlineAction({
  label,
  keys,
  onClick,
}: {
  label: string;
  keys: string;
  onClick: (() => void) | null;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onMouseDown={keepFocus}
      disabled={!onClick}
      onClick={onClick ?? undefined}
      className="flex h-7 items-center gap-2 rounded-md px-2 text-md text-fg-muted hover:bg-selected hover:text-fg disabled:opacity-40"
    >
      {label} <Kbd>{keys}</Kbd>
    </button>
  );
}
