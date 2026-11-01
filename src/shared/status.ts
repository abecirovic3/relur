/** Workspace states (spec §10.2). Set by hooks from M1; `starting` until then. */
export type WorkspaceState =
  | 'starting'
  | 'working'
  | 'needs-permission'
  | 'needs-input'
  | 'awaiting-approval'
  | 'done'
  | 'interrupted'
  | 'exited'
  | 'error';

/** The seven status glyphs of the design (components.md, Status glyph). */
export type StatusGlyph =
  | 'working'
  | 'permission'
  | 'input'
  | 'approval'
  | 'done'
  | 'exited'
  | 'error';

export const GLYPH_LABEL: Record<StatusGlyph, string> = {
  working: 'Working',
  permission: 'Needs permission',
  input: 'Waiting for input',
  approval: 'Awaiting approval',
  done: 'Done (unread)',
  exited: 'Exited',
  error: 'Error',
};

/** Each state in words, for the sidebar row's tooltip (spec §6.1). */
export const STATE_LABEL: Record<WorkspaceState, string> = {
  starting: 'Starting',
  working: 'Working',
  'needs-permission': 'Needs permission',
  'needs-input': 'Waiting for input',
  'awaiting-approval': 'Awaiting approval',
  done: 'Done',
  interrupted: 'Interrupted',
  exited: 'Exited',
  error: 'Error',
};

/** Short label for sidebar rows, in the glyph's color. */
export const GLYPH_ROW_LABEL: Record<StatusGlyph, string> = {
  working: 'Working',
  permission: 'Permission',
  input: 'Input',
  approval: 'Approve',
  done: 'Done',
  exited: 'Exited',
  error: 'Error',
};

/**
 * The glyph for a state, or null for none. Starting shows the working spinner
 * only while Claude launches (spec §6.3), then none until hooks report a
 * state; Done shows a glyph only until viewed; Interrupted shows none.
 */
export function glyphFor(
  state: WorkspaceState,
  unread = false,
  launching = false,
): StatusGlyph | null {
  switch (state) {
    case 'starting':
      return launching ? 'working' : null;
    case 'working':
      return 'working';
    case 'needs-permission':
      return 'permission';
    case 'needs-input':
      return 'input';
    case 'awaiting-approval':
      return 'approval';
    case 'done':
      return unread ? 'done' : null;
    case 'interrupted':
      return null;
    case 'exited':
      return 'exited';
    case 'error':
      return 'error';
  }
}

/** Whether a state counts toward profile tab and Dock badges (permission, input, approval). */
export function needsYou(state: WorkspaceState): boolean {
  return state === 'needs-permission' || state === 'needs-input' || state === 'awaiting-approval';
}

/**
 * The events a profile can play a sound for (spec §10.3), in Edit profile's
 * order; all off by default. `key` is the name in config.json.
 */
export const SOUND_EVENTS = [
  { key: 'needsPermission', state: 'needs-permission', label: 'Needs permission' },
  { key: 'needsInput', state: 'needs-input', label: 'Waiting for input' },
  {
    key: 'awaitingApproval',
    state: 'awaiting-approval',
    label: 'Awaiting approval',
    note: 'a workflow gate',
  },
  { key: 'done', state: 'done', label: 'Done' },
  { key: 'error', state: 'error', label: 'Error' },
] as const satisfies readonly {
  key: string;
  state: WorkspaceState;
  label: string;
  note?: string;
}[];

export type SoundKey = (typeof SOUND_EVENTS)[number]['key'];

/** The sound setting for a state, or null when it has no sound. */
export function soundKey(state: WorkspaceState): SoundKey | null {
  return SOUND_EVENTS.find((e) => e.state === state)?.key ?? null;
}

/**
 * What a workspace's background count means in words (spec §10.2): while
 * Working, Claude waits for its background agents; at Done, commands it
 * started are still running. Null when there's nothing to say.
 */
export function backgroundNote(state: WorkspaceState, background: number): string | null {
  if (background <= 0) return null;
  if (state === 'working') return `${background} in background`;
  if (state === 'done') return `${background} still running in the background`;
  return null;
}
