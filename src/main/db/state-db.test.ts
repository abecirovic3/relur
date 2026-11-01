import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openStateDb, SCHEMA_VERSION } from './state-db';

describe('openStateDb', () => {
  it('creates the schema and records its version', () => {
    const db = openStateDb(':memory:');
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    expect(tables).toContainEqual({ name: 'workspaces' });
  });

  it('reopens an existing database without re-running migrations', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-db-'));
    const file = path.join(dir, 'state.db');
    try {
      const first = openStateDb(file);
      first
        .prepare(
          `INSERT INTO workspaces (id, profile_id, project_id, name, branch, base_branch, worktree_path, status, created_at)
           VALUES ('ws', 'work', 'p', 'n', 'b', 'main', '/w', 'starting', '2026-01-01')`,
        )
        .run();
      first.close();
      const second = openStateDb(file);
      expect(second.prepare('SELECT count(*) AS n FROM workspaces').get()).toEqual({ n: 1 });
      second.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a database from a newer app version', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-db-'));
    const file = path.join(dir, 'state.db');
    try {
      const db = openStateDb(file);
      db.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
      db.close();
      expect(() => openStateDb(file)).toThrow(/newer than this app/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
