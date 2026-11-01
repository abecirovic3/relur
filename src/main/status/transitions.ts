import type { WorkspaceState } from '@shared/status';

export interface Transition {
  state: WorkspaceState;
  /** Shown with the state, e.g. what Claude waits for; null clears it. */
  message: string | null;
  /** How many of Claude's background tasks still run (spec §10.2). */
  background: number;
}

/** Where the workspace is when a hook event arrives. */
export interface Current {
  /** Its background count. */
  background?: number;
  /** Claude's turn has ended while it waits for background agents (spec §10.2). */
  waiting?: boolean;
}

const record = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * Whether a Notification hook says Claude waits for input rather than asks
 * for permission. Claude Code's `notification_type` decides when present;
 * otherwise the message text. Anything unrecognised counts as permission,
 * the more urgent case (spec §10.2).
 */
export function isIdleNotification(payload: unknown): boolean {
  const { notification_type: type, message } = record(payload);
  if (type === 'idle_prompt') return true;
  if (type === 'permission_prompt') return false;
  return typeof message === 'string' && /waiting for (your )?input/i.test(message);
}

/** One of Claude's background tasks, as the Stop hook lists them in `background_tasks`. */
export interface BackgroundTask {
  type: string;
  status: string;
}

/** The background tasks still running at Stop (spec §10.2); none when the payload has no list. */
export function runningBackgroundTasks(payload: unknown): BackgroundTask[] {
  const tasks = record(payload).background_tasks;
  if (!Array.isArray(tasks)) return [];
  return tasks
    .map(record)
    .map((t) => ({ type: String(t.type ?? ''), status: String(t.status ?? '') }))
    .filter((t) => t.status === 'running');
}

/**
 * Whether Claude surely continues once the task ends: a background agent
 * always hands its result back. A command Claude waits for and one it left
 * running on purpose (a dev server) look the same (checked live), so
 * commands, and types not known, don't count.
 */
export const waitedFor = (task: BackgroundTask) => task.type === 'subagent';

/**
 * The state a hook event moves a workspace to (spec §10.2), or null for none.
 * SessionStart changes nothing: Starting is set when Claude is spawned.
 */
export function transition(
  current: WorkspaceState,
  event: string,
  payload: unknown,
  { background = 0, waiting = false }: Current = {},
): Transition | null {
  switch (event) {
    case 'UserPromptSubmit':
    case 'PreToolUse':
    case 'PostToolUse':
      // Background work goes on until the next Stop counts it again.
      return { state: 'working', message: null, background };
    case 'Notification': {
      const message = record(payload).message;
      const text = typeof message === 'string' ? message : null;
      if (isIdleNotification(payload)) {
        // The idle notice after Done changes nothing and doesn't alert again; nor
        // does it while Claude waits for its background agents.
        if (current === 'done' || (current === 'working' && waiting)) return null;
        return { state: 'needs-input', message: text, background: 0 };
      }
      return { state: 'needs-permission', message: text, background: 0 };
    }
    case 'Stop': {
      // Waiting for background agents is still Working; commands left running
      // only add a note to Done.
      const running = runningBackgroundTasks(payload);
      return {
        state: running.some(waitedFor) ? 'working' : 'done',
        message: null,
        background: running.length,
      };
    }
    case 'SessionEnd':
      return { state: 'exited', message: null, background: 0 };
    default:
      return null;
  }
}
