import { EventEmitter } from 'node:events';
import type { UsageSnapshot } from '@shared/usage';
import type { StateDb } from './state-db';

/** The latest plan usage per profile (spec §11), kept in state.db across restarts. */
export class UsageRecords {
  private readonly events = new EventEmitter();

  constructor(private readonly db: StateDb) {}

  save(profileId: string, snapshot: UsageSnapshot): void {
    this.db
      .prepare(
        `INSERT INTO usage (profile_id, rate_limits, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (profile_id) DO UPDATE SET rate_limits = excluded.rate_limits,
           updated_at = excluded.updated_at`,
      )
      .run(profileId, JSON.stringify(snapshot), new Date(snapshot.updatedAt).toISOString());
    this.events.emit('change', profileId);
  }

  all(): Record<string, UsageSnapshot> {
    const rows = this.db.prepare('SELECT profile_id, rate_limits FROM usage').all() as {
      profile_id: string;
      rate_limits: string;
    }[];
    const out: Record<string, UsageSnapshot> = {};
    for (const row of rows) {
      try {
        out[row.profile_id] = JSON.parse(row.rate_limits) as UsageSnapshot;
      } catch {
        // an unreadable row is skipped
      }
    }
    return out;
  }

  onChange(listener: (profileId: string) => void): () => void {
    this.events.on('change', listener);
    return () => this.events.off('change', listener);
  }
}
