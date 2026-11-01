/** Compact age for "Active" columns: now, 12s, 4m, 2h, 3d. */
export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return '';
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 5) return 'now';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

/** Elapsed time for a Working row: 12s, 4m 05s, 1h 02m. */
export function elapsed(iso: string | null, now = Date.now()): string {
  if (!iso) return '';
  const total = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  if (total < 60) return `${total}s`;
  if (total < 3600) return `${Math.floor(total / 60)}m ${pad(total % 60)}s`;
  return `${Math.floor(total / 3600)}h ${pad(Math.floor((total % 3600) / 60))}m`;
}
