import type { SessionInfo } from '@shared/terminal-protocol';

/**
 * What a profile's main area shows: its home terminal, a project, a workspace,
 * or its setup check (spec §6.11).
 */
export type View =
  | { kind: 'home' }
  | { kind: 'setup'; then?: AfterSetup }
  | { kind: 'project'; projectId: string }
  | { kind: 'workspace'; projectId: string; workspaceId: string };

/**
 * What was asked for when the setup check showed instead (spec §6.11): it
 * opens, back in the view it was asked from, once the check passes.
 */
export type AfterSetup =
  | { open: 'newWorkspace'; from: View; projectId: string | null }
  | { open: 'startClaude'; from: View };

export const HOME: View = { kind: 'home' };

/** The project view's Workspaces tab; its other tabs are session ids. */
export const WORKSPACES_TAB = 'workspaces';
/** The project view's Setup tab (spec §8.3). */
export const SETUP_TAB = 'setup';
/** The project view's Skills tab (spec §13.2). */
export const SKILLS_TAB = 'skills';
/** The project view's own tabs besides Workspaces; its other tabs are session ids. */
/** The project view's Workflow tab (spec §13.4). */
export const WORKFLOW_TAB = 'workflow';
export const PROJECT_TABS: readonly string[] = [SETUP_TAB, SKILLS_TAB, WORKFLOW_TAB];

/** Stable key of a view, for remembering its selected tab. */
export function viewKey(view: View): string {
  if (view.kind === 'home' || view.kind === 'setup') return view.kind;
  if (view.kind === 'project') return `project:${view.projectId}`;
  return `workspace:${view.workspaceId}`;
}

/** Tab order in a workspace (spec §6.3): Claude, Setup, then shells. */
const TAB_RANK: Record<string, number> = { claude: 0, setup: 1 };

/**
 * The sessions shown in a view: the home shell, a project's main-checkout
 * sessions, or a workspace's sessions with Claude first and Setup next.
 */
export function sessionsOf(view: View, sessions: SessionInfo[]): SessionInfo[] {
  if (view.kind === 'home') return sessions.filter((s) => s.kind === 'home');
  if (view.kind === 'setup') return [];
  if (view.kind === 'project') {
    return sessions.filter((s) => s.projectId === view.projectId && s.workspaceId === null);
  }
  return sessions
    .filter((s) => s.workspaceId === view.workspaceId)
    .sort((a, b) => (TAB_RANK[a.kind] ?? 2) - (TAB_RANK[b.kind] ?? 2));
}

/** The view a session belongs to. */
export function viewOf(session: SessionInfo): View {
  if (session.kind === 'home' || !session.projectId) return HOME;
  if (session.workspaceId) {
    return { kind: 'workspace', projectId: session.projectId, workspaceId: session.workspaceId };
  }
  return { kind: 'project', projectId: session.projectId };
}
