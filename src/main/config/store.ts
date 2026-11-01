import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { toProfileColor } from '@shared/profile-colors';
import { type Config, ConfigSchema } from '@shared/schemas';
import { z } from 'zod';

export interface ConfigSnapshot {
  file: string;
  /** Last valid config; null only if the file has never been valid this run. */
  config: Config | null;
  /** Why the file on disk can't be used, if it can't. */
  error: string | null;
}

/** A new install's config.json; the New profile wizard adds the first profile. */
const EMPTY_CONFIG = { version: 1, profiles: [], projects: [] };

type RawConfig = Record<string, unknown> & { projects?: unknown[] };

function describe(error: unknown): string {
  if (error instanceof z.ZodError) return z.prettifyError(error);
  if (error instanceof Error) return error.message;
  return String(error);
}

function writeAtomic(file: string, data: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * `config.json`: hand-edited by the user and reloaded on request. Changes made
 * by the app go through `update`, which edits the raw JSON so fields the app
 * doesn't know about (later milestones, user notes) are kept.
 */
export class ConfigStore {
  private snapshot: ConfigSnapshot;
  private readonly events = new EventEmitter();

  constructor(readonly file: string) {
    this.snapshot = { file, config: null, error: null };
  }

  /** Reads the file, creating it without profiles on first launch (spec §3.4). */
  load(): ConfigSnapshot {
    if (!fs.existsSync(this.file)) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      writeAtomic(this.file, EMPTY_CONFIG);
    }
    this.convertHexColors();
    return this.reload();
  }

  /** Profile colors were `#rrggbb` before the palette; store the nearest name instead. */
  private convertHexColors(): void {
    try {
      const raw = this.readRaw();
      if (!Array.isArray(raw.profiles)) return;
      let changed = false;
      for (const profile of raw.profiles as unknown[]) {
        if (profile === null || typeof profile !== 'object') continue;
        const entry = profile as Record<string, unknown>;
        if (typeof entry.color === 'string' && /^#[0-9a-f]{6}$/i.test(entry.color)) {
          entry.color = toProfileColor(entry.color);
          changed = true;
        }
      }
      if (changed) writeAtomic(this.file, raw);
    } catch {
      // An unreadable file is reported by reload().
    }
  }

  reload(): ConfigSnapshot {
    try {
      const config = ConfigSchema.parse(this.readRaw());
      this.snapshot = { file: this.file, config, error: null };
    } catch (error) {
      this.snapshot = { ...this.snapshot, error: describe(error) };
    }
    this.events.emit('change', this.snapshot);
    return this.snapshot;
  }

  get(): ConfigSnapshot {
    return this.snapshot;
  }

  /** The current valid config, or an error explaining why there is none. */
  require(): Config {
    if (this.snapshot.error) throw new Error(`config.json is invalid: ${this.snapshot.error}`);
    if (!this.snapshot.config) throw new Error('config.json has not been loaded');
    return this.snapshot.config;
  }

  /**
   * Applies a change to the file as it is on disk now, validates the result
   * and writes it. Throws, leaving the file untouched, if either version is invalid.
   */
  update(change: (raw: RawConfig) => void): Config {
    const raw = this.readRaw();
    ConfigSchema.parse(raw);
    change(raw);
    const config = ConfigSchema.parse(raw);
    writeAtomic(this.file, raw);
    this.snapshot = { file: this.file, config, error: null };
    this.events.emit('change', this.snapshot);
    return config;
  }

  onChange(listener: (snapshot: ConfigSnapshot) => void): () => void {
    this.events.on('change', listener);
    return () => this.events.off('change', listener);
  }

  private readRaw(): RawConfig {
    const text = fs.readFileSync(this.file, 'utf8');
    const raw: unknown = JSON.parse(text);
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('config.json must contain a JSON object');
    }
    return raw as RawConfig;
  }
}
