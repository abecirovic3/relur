import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { envVar } from '../shared/brand';
import { runAdd } from './add';

let dir: string;
let out: string;
let err: string;
const io = {
  out: (t: string) => {
    out += t;
  },
  err: (t: string) => {
    err += t;
  },
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helper-add-'));
  out = '';
  err = '';
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('helper add', () => {
  it("says the app isn't running when there is no bridge, with exit 2", async () => {
    expect(await runAdd(['.'], { [envVar('CONFIG_DIR')]: dir }, dir, io)).toBe(2);
    expect(err).toMatch(/isn't running/);
  });

  it('deletes a stale cli.json whose app no longer answers', async () => {
    const file = path.join(dir, 'cli.json');
    fs.writeFileSync(file, JSON.stringify({ url: 'http://127.0.0.1:9', token: 't' }));
    expect(await runAdd(['.'], { [envVar('CONFIG_DIR')]: dir }, dir, io)).toBe(2);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('checks its arguments', async () => {
    expect(await runAdd(['--profile'], {}, dir, io)).toBe(1);
    expect(await runAdd(['--bogus'], {}, dir, io)).toBe(1);
    expect(await runAdd(['a', 'b'], {}, dir, io)).toBe(1);
    expect(await runAdd(['--help'], {}, dir, io)).toBe(0);
    expect(out).toMatch(/^usage: /);
  });
});
