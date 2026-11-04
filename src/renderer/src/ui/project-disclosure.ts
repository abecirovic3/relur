import { useState } from 'react';
import { remember } from './remember';

const KEY = 'sidebar-projects';

interface Disclosure {
  /** Projects you expanded yourself; they stay until you collapse them. */
  expanded: string[];
  /** The last workspace opened in each profile, whose project is expanded for it. */
  last: Record<string, { workspaceId: string; projectId: string }>;
}

function load(): Disclosure {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      expanded: Array.isArray(value.expanded) ? value.expanded : [],
      last: value.last && typeof value.last === 'object' ? value.last : {},
    };
  } catch {
    return { expanded: [], last: {} };
  }
}

const openIn = (d: Disclosure, profileId: string, projectId: string) =>
  d.expanded.includes(projectId) || d.last[profileId]?.projectId === projectId;

/**
 * Which sidebar projects are expanded (spec §6.1): the ones you expanded, and
 * the one holding the last opened workspace. Remembered across restarts in the
 * window's local storage.
 */
export function useProjectDisclosure() {
  const [state, setState] = useState(load);
  const update = (change: (current: Disclosure) => Disclosure) =>
    setState((current) => {
      const next = change(current);
      remember(KEY, JSON.stringify(next));
      return next;
    });

  return {
    isOpen: (profileId: string, projectId: string) => openIn(state, profileId, projectId),
    /** The caret: collapsing also lets go of the last workspace's hold on the project. */
    toggle: (profileId: string, projectId: string) =>
      update((current) => {
        if (!openIn(current, profileId, projectId)) {
          return { ...current, expanded: [...current.expanded, projectId] };
        }
        const last = { ...current.last };
        if (last[profileId]?.projectId === projectId) delete last[profileId];
        return { expanded: current.expanded.filter((id) => id !== projectId), last };
      }),
    /** A workspace was opened: its project expands, the previous one's collapses again. */
    opened: (profileId: string, workspaceId: string, projectId: string) => {
      const last = state.last[profileId];
      if (last?.workspaceId === workspaceId && last.projectId === projectId) return;
      update((current) => ({
        ...current,
        last: { ...current.last, [profileId]: { workspaceId, projectId } },
      }));
    },
  };
}
