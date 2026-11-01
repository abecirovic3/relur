import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { markShown, wasShown } from './notices';

describe('notices', () => {
  const dirs: string[] = [];
  const tempDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notices-'));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is shown once, and stays recorded', () => {
    const dir = tempDir();
    expect(wasShown(dir, 'window-closed')).toBe(false);
    markShown(dir, 'window-closed');
    expect(wasShown(dir, 'window-closed')).toBe(true);
    expect(fs.readdirSync(dir)).toEqual(['notices.json']);
  });

  it('reads an unreadable file as nothing shown, and replaces it', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'notices.json'), '[1,');
    expect(wasShown(dir, 'window-closed')).toBe(false);
    markShown(dir, 'window-closed');
    expect(wasShown(dir, 'window-closed')).toBe(true);
  });
});
