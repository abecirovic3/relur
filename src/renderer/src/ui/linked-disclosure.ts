import { useState } from 'react';
import { remember } from './remember';

const KEY = 'sidebar-linked-groups';

function load(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Which projects' Linked groups are expanded in the sidebar (spec §6.1, §21.1):
 * collapsed by default, remembered across restarts in the window's local storage.
 */
export function useLinkedDisclosure() {
  const [open, setOpen] = useState(load);
  return {
    isOpen: (projectId: string) => open.includes(projectId),
    toggle: (projectId: string) =>
      setOpen((current) => {
        const next = current.includes(projectId)
          ? current.filter((id) => id !== projectId)
          : [...current, projectId];
        remember(KEY, JSON.stringify(next));
        return next;
      }),
  };
}
