import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BRAND } from '@shared/brand';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cliInstallInfo, cliTarget, installCli } from './cli-install';
import { LAUNCHER_MARK, LEGACY_LAUNCHER_MARK } from './helper-files';

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-install-'));
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe('installCli', () => {
  it('writes an executable launcher that runs the helper, and says whether it is on PATH', () => {
    const info = installCli(home, '/usr/bin:/bin', '/app/helper');
    const target = cliTarget(home);
    expect(info).toMatchObject({ target, onPath: false });
    expect(fs.readFileSync(target, 'utf8')).toBe(
      `#!/bin/sh\n${LAUNCHER_MARK}\nexec '/app/helper' "$@"\n`,
    );
    expect(fs.statSync(target).mode & 0o111).not.toBe(0);
    expect(cliInstallInfo(home, `${path.dirname(target)}:/bin`).onPath).toBe(true);
    // An older launcher (a development build's, in the repository) is named, then replaced.
    expect(cliInstallInfo(home, '/bin', "/Applications/It's.app/helper").replaces).toBe(
      '/app/helper',
    );
    expect(cliInstallInfo(home, '/bin', '/app/helper').replaces).toBeNull();
    installCli(home, '/bin', "/Applications/It's.app/helper");
    expect(cliInstallInfo(home, '/bin').replaces).toBe("/Applications/It's.app/helper");
  });

  it("refuses to replace a file that isn't the app's", () => {
    fs.mkdirSync(path.dirname(cliTarget(home)), { recursive: true });
    fs.writeFileSync(cliTarget(home), '#!/bin/sh\necho mine\n');
    expect(cliInstallInfo(home, '').foreign).toBe(true);
    expect(() => installCli(home, '', '/app/helper')).toThrow(/already exists/);
  });

  it("replaces the old app's launcher and leaves the rest of ~/.local/bin alone", () => {
    const bin = path.join(home, '.local', 'bin');
    const legacy = path.join(bin, BRAND.legacy.cliCommand);
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(legacy, `#!/bin/sh\n${LEGACY_LAUNCHER_MARK}\nexec '/Old.app/helper' "$@"\n`);
    fs.writeFileSync(path.join(bin, 'uv'), 'mine');
    expect(cliInstallInfo(home, '').removesLegacy).toBe(legacy);
    installCli(home, '', '/app/helper');
    expect(fs.readdirSync(bin).sort()).toEqual([BRAND.cliCommand, 'uv'].sort());
    expect(fs.readFileSync(path.join(bin, 'uv'), 'utf8')).toBe('mine');
    expect(cliInstallInfo(home, '').removesLegacy).toBeNull();
  });

  it("keeps a file by the old name that isn't the old app's launcher", () => {
    const legacy = path.join(home, '.local', 'bin', BRAND.legacy.cliCommand);
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, '#!/bin/sh\necho mine\n');
    expect(cliInstallInfo(home, '').removesLegacy).toBeNull();
    installCli(home, '', '/app/helper');
    expect(fs.readFileSync(legacy, 'utf8')).toBe('#!/bin/sh\necho mine\n');
  });
});
