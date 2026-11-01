/** One plan-limit window from Claude Code's status line (spec §11). */
export interface UsageWindow {
  /** 0–100. */
  usedPercentage: number;
  /** When the window resets, ms since epoch; null if unknown. */
  resetsAt: number | null;
}

/** The latest plan usage of a profile (spec §11). */
export interface UsageSnapshot {
  fiveHour: UsageWindow | null;
  sevenDay: UsageWindow | null;
  /** When the status line last reported it, ms since epoch. */
  updatedAt: number;
}

/** After this long without an update the values are shown as stale. */
export const USAGE_STALE_MS = 10 * 60 * 1000;

const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

function window(v: unknown): UsageWindow | null {
  const w = record(v);
  const used = w?.used_percentage;
  if (typeof used !== 'number' || !Number.isFinite(used)) return null;
  const resets = w?.resets_at;
  return {
    usedPercentage: Math.min(100, Math.max(0, used)),
    resetsAt: typeof resets === 'number' && Number.isFinite(resets) ? resets * 1000 : null,
  };
}

/** Reads `rate_limits` (`five_hour`, `seven_day`); null when it has neither window. */
export function parseRateLimits(rateLimits: unknown, now = Date.now()): UsageSnapshot | null {
  const limits = record(rateLimits);
  const fiveHour = window(limits?.five_hour);
  const sevenDay = window(limits?.seven_day);
  if (!fiveHour && !sevenDay) return null;
  return { fiveHour, sevenDay, updatedAt: now };
}
