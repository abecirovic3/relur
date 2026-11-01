import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BRAND } from '@shared/brand';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stableHelper } from './helper-files';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'helper-files-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('stableHelper', () => {
  it('uses the bundled helper outside an AppImage', () => {
    expect(stableHelper('/opt/app/resources/helper/h', root, undefined)).toBe(
      '/opt/app/resources/helper/h',
    );
  });

  it("copies an AppImage's helper to the data dir, again only when it changed", () => {
    const mount = path.join(root, 'mount');
    fs.mkdirSync(mount);
    const bundled = path.join(mount, BRAND.helperCommand);
    fs.writeFileSync(bundled, 'v1', { mode: 0o755 });
    const data = path.join(root, 'data');
    const copy = stableHelper(bundled, data, '/home/u/Applications/App.AppImage');
    expect(copy).toBe(path.join(data, 'helper', BRAND.helperCommand));
    expect(fs.readFileSync(copy, 'utf8')).toBe('v1');
    expect(fs.statSync(copy).mode & 0o111).not.toBe(0);
    const before = fs.statSync(copy).mtimeMs;
    stableHelper(bundled, data, 'x');
    expect(fs.statSync(copy).mtimeMs).toBe(before);
    fs.writeFileSync(bundled, 'v2');
    stableHelper(bundled, data, 'x');
    expect(fs.readFileSync(copy, 'utf8')).toBe('v2');
  });
});
