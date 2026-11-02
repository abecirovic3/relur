import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { type Release, releaseOf, shouldOffer, UPDATE_INTERVAL_MS } from '@shared/updates';

/** What the window shows (spec §15.7). */
export interface UpdateState {
  /** The first-start question is unanswered. */
  ask: boolean;
  /** A newer release to offer in the notice; null when there is none to show. */
  available: Release | null;
  /** This app's version. */
  current: string;
}

/** What a manual check found, for its message. */
export type CheckResult =
  | { kind: 'newer'; release: Release }
  | { kind: 'current' }
  | { kind: 'failed'; reason: string };

/** What the service needs; replaced in tests. */
export interface UpdateDeps {
  version: string;
  /** The API's answer for the latest release; throws with the reason. */
  fetchLatest(): Promise<unknown>;
  /** Check for Updates Automatically: unset until the first-start question is answered. */
  automatic(): boolean | undefined;
  setAutomatic(on: boolean): void;
  /** The version the user skipped. */
  skipped(): string | null;
  setSkipped(version: string): void;
}

/**
 * New versions (spec §15.7): asks once whether to check; then, when the user
 * agreed, asks GitHub at start and every 24 hours. A failure stays quiet
 * unless the user asked; a skipped version is offered again only when asked.
 */
export class UpdateService {
  private readonly events = new EventEmitter();
  private available: Release | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly deps: UpdateDeps,
    private readonly intervalMs = UPDATE_INTERVAL_MS,
  ) {}

  /** At start: the question, or the first check and the daily ones. */
  start(): void {
    this.schedule();
    this.changed();
  }

  /** The first-start question's answer: Check for updates or No thanks. */
  answer(check: boolean): void {
    this.setAutomatic(check);
  }

  /** The menu's Check for Updates Automatically, and the question's answer. */
  setAutomatic(on: boolean): void {
    this.deps.setAutomatic(on);
    this.schedule();
    this.changed();
  }

  /**
   * Asks GitHub. Automatic checks show a newer version in the notice and stay
   * quiet otherwise; a manual one (Check for Updates…) also shows a skipped
   * version and returns what it found, so the menu can say so.
   */
  async check({ manual = false }: { manual?: boolean } = {}): Promise<CheckResult> {
    let release: Release | null;
    try {
      release = releaseOf(await this.deps.fetchLatest());
    } catch (error) {
      return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) };
    }
    if (
      release &&
      shouldOffer(release, this.deps.version, { skipped: this.deps.skipped(), manual })
    ) {
      this.available = release;
      this.changed();
      return { kind: 'newer', release };
    }
    return { kind: 'current' };
  }

  /** Skip this version: not offered again, until a newer one or a manual check. */
  skip(): void {
    if (!this.available) return;
    this.deps.setSkipped(this.available.version);
    this.available = null;
    this.changed();
  }

  /** Hides the notice until the next check. */
  dismiss(): void {
    this.available = null;
    this.changed();
  }

  state(): UpdateState {
    return {
      ask: this.deps.automatic() === undefined,
      available: this.available,
      current: this.deps.version,
    };
  }

  onChange(listener: () => void): () => void {
    this.events.on('change', listener);
    return () => this.events.off('change', listener);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    this.dispose();
    if (this.deps.automatic() !== true) return;
    void this.check();
    this.timer = setInterval(() => void this.check(), this.intervalMs);
    this.timer.unref?.();
  }

  private changed(): void {
    this.events.emit('change');
  }
}

/** `updates.json` in the app config dir: the version the user skipped. */
export function skippedStore(configDir: string) {
  const file = path.join(configDir, 'updates.json');
  const read = (): Record<string, unknown> => {
    try {
      const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  return {
    get: (): string | null => {
      const skipped = read().skipped;
      return typeof skipped === 'string' ? skipped : null;
    },
    set: (version: string) => {
      const tmp = `${file}.${process.pid}.tmp`;
      try {
        fs.writeFileSync(tmp, `${JSON.stringify({ ...read(), skipped: version }, null, 2)}\n`);
        fs.renameSync(tmp, file);
      } catch {
        // Not remembered: offered again at the next check.
        fs.rmSync(tmp, { force: true });
      }
    },
  };
}
