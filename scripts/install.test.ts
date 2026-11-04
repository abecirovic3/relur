/**
 * install.sh against a fake release on a file:// URL, never GitHub: download,
 * checksum, install, update, the launcher, quitting a running copy, and
 * --uninstall. Everything happens under a throwaway HOME and install folder.
 */
import { type ChildProcess, execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as pty from 'node-pty';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LEGACY_LAUNCHER_MARK, launcherScript, launcherTarget } from '../src/main/helper-files';
import { BRAND, CHECKSUMS_FILE, envVar, releaseAsset } from '../src/shared/brand';
import { installScript } from './gen-install';

const root = path.resolve(__dirname, '..');
const mac = process.platform === 'darwin';
const arch =
  mac && execFileSync('sysctl', ['-n', 'hw.optional.arm64'], { encoding: 'utf8' }).trim() === '1'
    ? 'arm64'
    : 'x64';
const app = `${BRAND.displayName}.app`;

let dir: string;
let home: string;
let apps: string;
let release: string;
let running: ChildProcess | null = null;

/** A stand-in app: an executable that waits, and the helper. */
function fakeRelease(version: string) {
  const stage = path.join(dir, `stage-${version}`);
  const bundle = path.join(stage, app, 'Contents');
  fs.mkdirSync(path.join(bundle, 'MacOS'), { recursive: true });
  fs.mkdirSync(path.join(bundle, 'Resources', 'helper'), { recursive: true });
  fs.writeFileSync(
    path.join(bundle, 'MacOS', BRAND.displayName),
    "#!/bin/sh\ntrap 'exit 0' TERM\nwhile :; do sleep 1; done\n",
    {
      mode: 0o755,
    },
  );
  fs.writeFileSync(path.join(bundle, 'Resources', 'helper', BRAND.helperCommand), '#!/bin/sh\n', {
    mode: 0o755,
  });
  fs.writeFileSync(path.join(bundle, 'version'), version);
  fs.mkdirSync(release, { recursive: true });
  const zip = path.join(release, releaseAsset(arch, 'zip'));
  fs.rmSync(zip, { force: true });
  execFileSync('ditto', ['-c', '-k', '--keepParent', path.join(stage, app), zip]);
  const hash = createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
  fs.writeFileSync(path.join(release, CHECKSUMS_FILE), `${hash}  ${releaseAsset(arch, 'zip')}\n`);
}

/**
 * Starts a stand-in app and waits until install.sh would find it (`pgrep -f`,
 * as it looks): right after spawn, under load, the new process may not be
 * listed yet, and install.sh would take the app as not running.
 */
async function startApp(exe: string): Promise<ChildProcess> {
  const child = spawn(exe, [], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    if (spawnSync('pgrep', ['-f', exe]).status === 0) return child;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`${exe} never showed up as running`);
}

const run = (...args: string[]) =>
  spawnSync('sh', [path.join(root, 'install.sh'), ...args], {
    encoding: 'utf8',
    env: {
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      HOME: home,
      [envVar('INSTALL_DIR')]: apps,
      [envVar('INSTALL_BASE_URL')]: `file://${release}`,
    },
  });

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'install-sh-')));
  home = path.join(dir, 'home');
  apps = path.join(dir, 'Applications');
  release = path.join(dir, 'release');
  fs.mkdirSync(home);
});
afterEach(() => {
  running?.kill('SIGKILL');
  running = null;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('install.sh', () => {
  it('is generated from the template with the values in BRAND', () => {
    expect(fs.readFileSync(path.join(root, 'install.sh'), 'utf8')).toBe(installScript());
    expect(fs.statSync(path.join(root, 'install.sh')).mode & 0o111).not.toBe(0);
  });

  it.skipIf(!mac)(
    'installs from a release, checks the checksum, updates and uninstalls',
    async () => {
      fakeRelease('1');
      const first = run();
      expect(first.status, first.stderr).toBe(0);
      expect(first.stdout).toMatch(/Checksum matches\./);
      expect(first.stdout).toMatch(new RegExp(`${BRAND.displayName} installed: ${apps}/${app}`));
      const installed = path.join(apps, app, 'Contents');
      expect(fs.readFileSync(path.join(installed, 'version'), 'utf8')).toBe('1');
      // The launcher is the app's own, pointing at the installed helper.
      const launcher = path.join(home, '.local', 'bin', BRAND.cliCommand);
      const helper = path.join(installed, 'Resources', 'helper', BRAND.helperCommand);
      expect(fs.readFileSync(launcher, 'utf8')).toBe(launcherScript(helper));
      expect(launcherTarget(fs.readFileSync(launcher, 'utf8'))).toBe(helper);
      expect(first.stdout).toMatch(/export PATH="\$HOME\/\.local\/bin:\$PATH"/);
      // No terminal: no question, just how to open it.
      expect(first.stdout).not.toMatch(/now\? \[Y\/n\]/);
      expect(first.stdout).toContain(`run: open "${apps}/${app}"`);

      // Running it again updates; a running copy is quit first (--yes: no question).
      fakeRelease('2');
      running = await startApp(path.join(installed, 'MacOS', BRAND.displayName));
      const second = run('--yes');
      expect(second.status, second.stderr).toBe(0);
      expect(second.stdout).toMatch(/Quit [^\n]*\.\n[\s\S]*updated/);
      expect(fs.readFileSync(path.join(installed, 'version'), 'utf8')).toBe('2');

      const removed = run('--uninstall');
      expect(removed.status, removed.stderr).toBe(0);
      expect(fs.existsSync(path.join(apps, app))).toBe(false);
      expect(fs.existsSync(launcher)).toBe(false);
      expect(removed.stdout).toMatch(/Kept your settings in .*Application Support/);
    },
  );

  it.skipIf(!mac)('offers to open the app when run in a terminal, but not with --yes', async () => {
    fakeRelease('1');
    // On a terminal of its own, answering No, so the stand-in app isn't opened.
    const inTerminal = (...args: string[]) =>
      new Promise<{ status: number; output: string }>((resolve) => {
        const term = pty.spawn('sh', [path.join(root, 'install.sh'), ...args], {
          env: {
            PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
            HOME: home,
            [envVar('INSTALL_DIR')]: apps,
            [envVar('INSTALL_BASE_URL')]: `file://${release}`,
          },
        });
        let output = '';
        term.onData((data) => {
          output += data;
          if (data.includes('[Y/n]')) term.write('n\r');
        });
        term.onExit(({ exitCode }) => resolve({ status: exitCode, output }));
      });
    const asked = await inTerminal();
    expect(asked.status, asked.output).toBe(0);
    expect(asked.output).toContain(`Open ${BRAND.displayName} now? [Y/n]`);
    expect(asked.output).toContain(`run: open "${apps}/${app}"`);
    const told = await inTerminal('--yes');
    expect(told.status, told.output).toBe(0);
    expect(told.output).not.toContain('now? [Y/n]');
    expect(told.output).toContain(`run: open "${apps}/${app}"`);
  });

  it.skipIf(!mac)('refuses a download whose checksum is wrong, and installs nothing', () => {
    fakeRelease('1');
    fs.writeFileSync(
      path.join(release, CHECKSUMS_FILE),
      `${'0'.repeat(64)}  ${releaseAsset(arch, 'zip')}\n`,
    );
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/doesn't match its checksum; nothing was installed/);
    expect(fs.existsSync(path.join(apps, app))).toBe(false);
  });

  it.skipIf(!mac)(
    "keeps a launcher that isn't the app's, and won't quit without a yes",
    async () => {
      fakeRelease('1');
      const launcher = path.join(home, '.local', 'bin', BRAND.cliCommand);
      fs.mkdirSync(path.dirname(launcher), { recursive: true });
      fs.writeFileSync(launcher, '#!/bin/sh\necho mine\n');
      const first = run();
      expect(first.status, first.stderr).toBe(0);
      expect(first.stdout).toMatch(/Left .* alone: it isn't/);
      expect(fs.readFileSync(launcher, 'utf8')).toBe('#!/bin/sh\necho mine\n');
      // No terminal to ask on: a running copy stays, and nothing changes.
      running = await startApp(path.join(apps, app, 'Contents', 'MacOS', BRAND.displayName));
      // Its own session (detached): there is no /dev/tty to ask on.
      const child = spawn('sh', [path.join(root, 'install.sh')], {
        env: {
          PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
          HOME: home,
          [envVar('INSTALL_DIR')]: apps,
          [envVar('INSTALL_BASE_URL')]: `file://${release}`,
        },
        detached: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString();
      });
      const status = await new Promise<number | null>((resolve) => child.on('close', resolve));
      expect(status).toBe(1);
      expect(stderr).toMatch(/is running\. Quit it, then run this again\./);
      expect(running.exitCode).toBeNull();
    },
  );

  it.skipIf(!mac)(
    'quits and removes the old app, replaces its launcher, and leaves the rest of ~/.local/bin',
    async () => {
      fakeRelease('1');
      const oldName = BRAND.legacy.displayName;
      const oldExe = path.join(apps, `${oldName}.app`, 'Contents', 'MacOS', oldName);
      fs.mkdirSync(path.dirname(oldExe), { recursive: true });
      fs.writeFileSync(oldExe, "#!/bin/sh\ntrap 'exit 0' TERM\nwhile :; do sleep 1; done\n", {
        mode: 0o755,
      });
      const bin = path.join(home, '.local', 'bin');
      const oldLauncher = path.join(bin, BRAND.legacy.cliCommand);
      fs.mkdirSync(bin, { recursive: true });
      fs.writeFileSync(oldLauncher, `#!/bin/sh\n${LEGACY_LAUNCHER_MARK}\nexec '/x/helper' "$@"\n`);
      fs.writeFileSync(path.join(bin, 'uv'), 'mine');
      running = await startApp(oldExe);

      const result = run('--yes');
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(`Quit ${oldName}.`);
      expect(result.stdout).toContain(`Removed ${apps}/${oldName}.app`);
      expect(result.stdout).toContain(`Removed ${oldName}'s launcher, ${oldLauncher}`);
      expect(fs.existsSync(path.join(apps, `${oldName}.app`))).toBe(false);
      expect(fs.existsSync(path.join(apps, app))).toBe(true);
      expect(fs.readdirSync(bin).sort()).toEqual([BRAND.cliCommand, 'uv'].sort());
      expect(fs.readFileSync(path.join(bin, 'uv'), 'utf8')).toBe('mine');

      // Run from a terminal of the app it has to quit, it stops before anything changes.
      running = await startApp(path.join(apps, app, 'Contents', 'MacOS', BRAND.displayName));
      const inside = spawnSync('sh', [path.join(root, 'install.sh'), '--yes'], {
        encoding: 'utf8',
        env: {
          PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
          HOME: home,
          TERM_PROGRAM: BRAND.displayName,
          [envVar('INSTALL_DIR')]: apps,
          [envVar('INSTALL_BASE_URL')]: `file://${release}`,
        },
      });
      expect(inside.status).toBe(1);
      expect(inside.stderr).toMatch(/This terminal belongs to/);
      expect(running.exitCode).toBeNull();
      running.kill('SIGKILL');

      // A file by the old name that isn't the old app's launcher stays.
      fs.writeFileSync(oldLauncher, '#!/bin/sh\necho mine\n');
      expect(run('--yes').status).toBe(0);
      expect(fs.readFileSync(oldLauncher, 'utf8')).toBe('#!/bin/sh\necho mine\n');
    },
  );
});

// Linux (in the Docker check): the AppImage, its desktop entry, icons, the
// helper copy and the launcher; a running copy found by its lock file.
describe.runIf(process.platform === 'linux')('install.sh on Linux', () => {
  const linuxArch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const exe = BRAND.linuxExecutable;
  let config: string;
  let data: string;

  /**
   * A stand-in AppImage: `--appimage-extract <pattern>` writes the helper and
   * an icon as the real one has them; started, it holds Chromium's lock file
   * in the settings folder until SIGTERM.
   */
  function fakeAppImage(version: string): string {
    fs.mkdirSync(release, { recursive: true });
    const file = path.join(release, releaseAsset(linuxArch, 'AppImage'));
    fs.writeFileSync(
      file,
      `#!/bin/sh
if [ "$1" = --appimage-extract ]; then
  case "$2" in
    resources/*) mkdir -p squashfs-root/resources/helper
      printf '#!/bin/sh\\necho helper-${version}\\n' >squashfs-root/resources/helper/${BRAND.helperCommand}
      chmod 755 squashfs-root/resources/helper/${BRAND.helperCommand} ;;
    usr/*) mkdir -p squashfs-root/usr/share/icons/hicolor/256x256/apps
      echo png >squashfs-root/usr/share/icons/hicolor/256x256/apps/${exe}.png ;;
  esac
  exit 0
fi
lock="\${XDG_CONFIG_HOME}/${BRAND.slug}/SingletonLock"
mkdir -p "$(dirname "$lock")"
ln -sfn "host-$$" "$lock"
trap 'rm -f "$lock"; exit 0' TERM
while :; do sleep 1; done
`,
      { mode: 0o755 },
    );
    const hash = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    fs.writeFileSync(
      path.join(release, CHECKSUMS_FILE),
      `${hash}  ${releaseAsset(linuxArch, 'AppImage')}\n`,
    );
    return file;
  }

  const env = () => ({
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    HOME: home,
    XDG_CONFIG_HOME: config,
    XDG_DATA_HOME: data,
    [envVar('INSTALL_DIR')]: apps,
    [envVar('INSTALL_BASE_URL')]: `file://${release}`,
  });
  const runLinux = (...args: string[]) =>
    spawnSync('sh', [path.join(root, 'install.sh'), ...args], { encoding: 'utf8', env: env() });

  beforeEach(() => {
    config = path.join(home, '.config');
    data = path.join(home, '.local', 'share');
  });

  it('installs the AppImage with its desktop entry, icon, helper and launcher; updates; uninstalls', async () => {
    fakeAppImage('1');
    const first = runLinux();
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toMatch(/Checksum matches\./);
    const appImage = path.join(apps, `${BRAND.displayName}.AppImage`);
    expect(first.stdout).toContain(`${BRAND.displayName} installed: ${appImage}`);
    expect(fs.statSync(appImage).mode & 0o111).not.toBe(0);

    const desktop = fs.readFileSync(path.join(data, 'applications', `${exe}.desktop`), 'utf8');
    expect(desktop).toContain(`Exec="${appImage}" %U`);
    expect(desktop).toContain(`Icon=${exe}`);
    expect(desktop).toContain(`StartupWMClass=${exe}`);
    expect(
      fs.existsSync(path.join(data, 'icons', 'hicolor', '256x256', 'apps', `${exe}.png`)),
    ).toBe(true);

    // The launcher runs the helper copied out of the AppImage, where the app keeps it.
    const helper = path.join(config, BRAND.slug, 'helper', BRAND.helperCommand);
    const launcher = path.join(home, '.local', 'bin', BRAND.cliCommand);
    expect(launcherTarget(fs.readFileSync(launcher, 'utf8'))).toBe(helper);
    expect(execFileSync(launcher, { encoding: 'utf8' }).trim()).toBe('helper-1');
    expect(first.stdout).toContain(`run: "${appImage}"`);

    // An update quits the running copy (found by its lock and APPIMAGE) first.
    fakeAppImage('2');
    running = spawn(appImage, [], { stdio: 'ignore', env: { ...env(), APPIMAGE: appImage } });
    const lock = path.join(config, BRAND.slug, 'SingletonLock');
    // Found by its lock, which it writes once it runs.
    const locked = () => {
      try {
        return fs.readlinkSync(lock) === `host-${running?.pid}`;
      } catch {
        return false;
      }
    };
    for (let i = 0; i < 100 && !locked(); i++) await new Promise((r) => setTimeout(r, 50));
    expect(locked(), 'the stand-in AppImage runs').toBe(true);
    const second = runLinux('--yes');
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toMatch(/Quit [^\n]*\.\n[\s\S]*updated/);
    expect(execFileSync(launcher, { encoding: 'utf8' }).trim()).toBe('helper-2');

    const removed = runLinux('--uninstall');
    expect(removed.status, removed.stderr).toBe(0);
    expect(fs.existsSync(appImage)).toBe(false);
    expect(fs.existsSync(path.join(data, 'applications', `${exe}.desktop`))).toBe(false);
    expect(
      fs.existsSync(path.join(data, 'icons', 'hicolor', '256x256', 'apps', `${exe}.png`)),
    ).toBe(false);
    expect(fs.existsSync(launcher)).toBe(false);
    expect(fs.existsSync(helper)).toBe(false);
    expect(removed.stdout).toContain(`Kept your settings in ${path.join(config, BRAND.slug)}`);
  });

  it("installs from a dist/ folder, and leaves a desktop entry that isn't its own", () => {
    fakeAppImage('1');
    const desktop = path.join(data, 'applications', `${exe}.desktop`);
    const result = runLinux('--from', release);
    expect(result.status, result.stderr).toBe(0);
    fs.writeFileSync(desktop, '[Desktop Entry]\nName=mine\n');
    expect(runLinux('--uninstall').status).toBe(0);
    expect(fs.readFileSync(desktop, 'utf8')).toBe('[Desktop Entry]\nName=mine\n');
  });
});
