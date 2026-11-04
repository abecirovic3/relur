/**
 * End-to-end test of new versions (spec §15.7), against a fake release
 * endpoint on 127.0.0.1: the first-start question (nothing is sent before
 * it's answered), the menu items, the notice with Release notes, Update
 * without a terminal, Skip this version, and the manual check's messages.
 * Also Help's Report a Bug… and Request a Feature… and their Guide links
 * (spec §6.12): the issue forms' URLs, opened in the (stubbed) browser.
 * Runs with a throwaway HOME and a fake `claude`; never reaches GitHub.
 *
 *   tsx scripts/e2e-updates.ts [--dev] [extra Electron args…]
 */
import './lib/clean-env';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { appConfigDir } from '../src/main/paths';
import { createFixture } from '../src/main/test-support/git-fixtures';
import { SEED_CONFIG } from '../src/main/test-support/seed-config';
import { BRAND, envVar } from '../src/shared/brand';
import { INSTALL_COMMAND, UPDATE_QUESTION } from '../src/shared/updates';
import {
  type Cdp,
  clickButtonText,
  launchApp,
  type RunningApp,
  sleep,
  withDisplayEnv,
} from './lib/app-driver';

const args = process.argv.slice(2);
const devMode = args.includes('--dev');
const electronArgs = args.filter((a) => a !== '--dev');

/** What the fake endpoint answers, and what it was asked. */
const endpoint = {
  status: 200,
  tag: 'v99.0.0',
  requests: [] as http.IncomingHttpHeaders[],
};

/** The release page and the answer, as GitHub's API gives them. */
const releasePage = (tag: string) => `https://github.com/example/app/releases/tag/${tag}`;

/** A menu item by label, clicked as when chosen from the menu; returns its checked state. */
const clickMenuItem = (main: Cdp, label: string) =>
  main.eval(`(() => {
    const { Menu } = process.mainModule.require('electron');
    const find = (items) => items.flatMap((i) => [i, ...(i.submenu ? find(i.submenu.items) : [])]);
    find(Menu.getApplicationMenu().items).find((i) => i.label === ${JSON.stringify(label)}).click();
  })()`);
const menuChecked = (main: Cdp, label: string) =>
  main.eval<boolean>(`(() => {
    const { Menu } = process.mainModule.require('electron');
    const find = (items) => items.flatMap((i) => [i, ...(i.submenu ? find(i.submenu.items) : [])]);
    return find(Menu.getApplicationMenu().items).find((i) => i.label === ${JSON.stringify(label)}).checked;
  })()`);

/** Native message boxes and links opened in the browser are recorded, not shown. */
const recordMainEffects = (main: Cdp) =>
  main.eval(`(() => {
    const { dialog, shell } = process.mainModule.require('electron');
    globalThis.__messages = [];
    globalThis.__opened = [];
    dialog.showMessageBox = async (...a) => {
      const o = a.at(-1);
      globalThis.__messages.push(o.message + (o.detail ? ' | ' + o.detail : ''));
      return { response: 0, checkboxChecked: false };
    };
    shell.openExternal = async (url) => { globalThis.__opened.push(url); };
  })()`);

async function waitUntil(what: string, check: () => boolean | Promise<boolean>, ms = 10_000) {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (await check()) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function main() {
  const server = http.createServer((req, res) => {
    endpoint.requests.push(req.headers);
    res.writeHead(endpoint.status, { 'content-type': 'application/json' });
    res.end(
      endpoint.status === 200
        ? JSON.stringify({
            tag_name: endpoint.tag,
            html_url: releasePage(endpoint.tag),
            draft: false,
            prerelease: false,
            assets: [],
          })
        : JSON.stringify({ message: 'Server Error' }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/repos/latest`;

  const fx = createFixture();
  let app: RunningApp | undefined;
  try {
    fs.writeFileSync(path.join(fx.root, '.zshrc'), '');
    const fakeClaude = path.join(fx.root, 'bin', 'fake-claude');
    fs.mkdirSync(path.dirname(fakeClaude));
    fs.writeFileSync(
      fakeClaude,
      `#!/bin/sh
case "$1" in
  --version) echo '9.9.9 (Claude Code)'; exit 0 ;;
  auth) printf '{"loggedIn":true,"email":"test@example.com","configDirectory":"%s"}\\n' "\${CLAUDE_CONFIG_DIR:-$HOME/.claude}"; exit 0 ;;
esac
exec sleep 600
`,
      { mode: 0o755 },
    );
    fs.writeFileSync(path.join(fx.root, '.claude.json'), '{}');
    fs.mkdirSync(path.join(fx.root, '.claude-personal'));
    fs.writeFileSync(path.join(fx.root, '.claude-personal', '.claude.json'), '{}');
    const configDir = appConfigDir({ platform: process.platform, env: {}, homeDir: fx.root });
    const configFile = path.join(configDir, 'config.json');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      configFile,
      JSON.stringify({
        ...SEED_CONFIG,
        profiles: SEED_CONFIG.profiles.map((p) => ({
          ...p,
          claude: { command: fakeClaude, args: [] },
        })),
      }),
    );
    const readConfig = () => JSON.parse(fs.readFileSync(configFile, 'utf8'));
    const env = {
      ...fx.env,
      [envVar('UPDATE_URL')]: url,
      // Update shows the command: a test never opens a terminal or runs the installer.
      [envVar('UPDATE_TERMINAL')]: 'none',
    };
    const launch = async () => {
      const running = await launchApp({ env: withDisplayEnv(env), dev: devMode, electronArgs });
      app = running;
      await recordMainEffects(running.main);
      return running;
    };
    const quit = async (running: RunningApp) => {
      running.page.close();
      running.main.close();
      assert.equal(await running.stop(), false, 'the app quit by itself');
      app = undefined;
    };
    const AUTO = 'Check for Updates Automatically';
    const NOW = 'Check for Updates…';
    const notice = `document.querySelector('[data-update-notice]')`;

    // 1. The first start asks, in a bar, and sends nothing meanwhile.
    let running = await launch();
    let { page, main: mainProcess } = running;
    const version = await mainProcess.eval<string>(
      `process.mainModule.require('electron').app.getVersion()`,
    );
    await page.waitFor(`!!document.querySelector('[data-update-ask]')`, 'the question');
    assert.equal(await page.eval(`!!document.querySelector('dialog[open]')`), false, 'no dialog');
    assert.match(
      await page.eval<string>(`document.querySelector('[data-update-ask]').innerText`),
      new RegExp(UPDATE_QUESTION.replace(/[.?]/g, '\\$&')),
    );
    await sleep(1500);
    assert.equal(endpoint.requests.length, 0, 'nothing is sent before the answer');
    assert.equal(await menuChecked(mainProcess, AUTO), false);
    await clickButtonText(page, 'No thanks');
    await page.waitFor(`!document.querySelector('[data-update-ask]')`, 'the question answered');
    assert.equal(readConfig().checkForUpdates, false);
    await sleep(1000);
    assert.equal(endpoint.requests.length, 0, 'No thanks sends nothing');

    // 2. The menu's checkbox turns it on: a check, with the app's name and
    //    version and no cookies, and the notice.
    await clickMenuItem(mainProcess, AUTO);
    await page.waitFor(`${notice}?.dataset.updateNotice === '99.0.0'`, 'the notice');
    assert.equal(readConfig().checkForUpdates, true);
    assert.equal(await menuChecked(mainProcess, AUTO), true);
    assert.equal(endpoint.requests.length, 1);
    const headers = endpoint.requests[0] ?? {};
    assert.equal(headers['user-agent'], `${BRAND.displayName}/${version}`);
    assert.equal(headers.cookie, undefined);
    assert.equal(headers.authorization, undefined);
    assert.match(
      await page.eval<string>(`${notice}.innerText`),
      new RegExp(`${BRAND.displayName} 99\\.0\\.0 is available`),
    );
    assert.equal(await page.eval(`!!document.querySelector('dialog[open]')`), false, 'no dialog');

    // Release notes open the release page in the browser.
    await page.eval(`document.querySelector('[data-release-notes]').click()`);
    await waitUntil('the release page', async () =>
      (await mainProcess.eval<string[]>('globalThis.__opened')).includes(releasePage('v99.0.0')),
    );
    // Update without a terminal: the install command, with Copy.
    await clickButtonText(page, 'Update', notice);
    await page.waitFor(
      `document.querySelector('[data-update-action]')?.dataset.updateAction === 'command'`,
      'the command',
    );
    assert.equal(
      await page.eval(`document.querySelector('[data-update-action] [data-command]').textContent`),
      INSTALL_COMMAND,
    );

    // 3. Skip this version: remembered; Check for Updates… shows it anyway.
    await clickButtonText(page, 'Skip this version', notice);
    await page.waitFor(`!${notice}`, 'the notice skipped');
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(configDir, 'updates.json'), 'utf8')).skipped,
      '99.0.0',
    );
    await clickMenuItem(mainProcess, NOW);
    await page.waitFor(`!!${notice}`, 'the skipped version, asked for');
    await page.eval(`${notice}.querySelector('[aria-label="Hide"]').click()`);
    await page.waitFor(`!${notice}`, 'hidden');

    // The manual check says when there's nothing newer, and why it failed.
    endpoint.tag = `v${version}`;
    await clickMenuItem(mainProcess, NOW);
    await waitUntil('the up-to-date message', async () =>
      (await mainProcess.eval<string[]>('globalThis.__messages')).includes(
        `${BRAND.displayName} ${version} is the latest version`,
      ),
    );
    endpoint.status = 500;
    await clickMenuItem(mainProcess, NOW);
    await waitUntil('the failure message', async () =>
      (await mainProcess.eval<string[]>('globalThis.__messages')).some((m) =>
        /^Couldn't check for updates \| GitHub answered 500/.test(m),
      ),
    );
    assert.equal(await page.eval(`!!${notice}`), false);

    // Report a Bug… and Request a Feature… (spec §6.12): the issue forms, the
    // bug report prefilled with the versions; nothing else is sent.
    const NEW_ISSUE = `https://github.com/${BRAND.github.owner}/${BRAND.github.repo}/issues/new`;
    const opened = () => mainProcess.eval<string[]>('globalThis.__opened');
    const lastOpened = async (count: number, what: string) => {
      await waitUntil(what, async () => (await opened()).length === count);
      return (await opened()).at(-1) ?? '';
    };
    const checkBugReport = (url: string, what: string) => {
      assert.ok(url.startsWith(`${NEW_ISSUE}?template=bug_report.yml&`), `${what}: ${url}`);
      const params = new URL(url).searchParams;
      assert.equal(params.get('app-version'), version, what);
      // Tests run the unpackaged build.
      assert.equal(params.get('os'), 'Built from source', what);
      const osVersion = params.get('os-version') ?? '';
      if (process.platform === 'darwin') assert.match(osVersion, /^macOS \d+(\.\d+)*$/, what);
      else assert.ok(osVersion.length > 0, what);
      // From the setup check (the fake claude's --version).
      assert.equal(params.get('claude-version'), '9.9.9', what);
      // Encoded: spaces as %20, never a raw space.
      assert.ok(!url.includes(' '), what);
    };
    const helpItems = await mainProcess.eval<string[]>(`(() => {
      const { Menu } = process.mainModule.require('electron');
      const help = Menu.getApplicationMenu().items.find((i) => i.role === 'help');
      return help.submenu.items.map((i) => i.type === 'separator' ? '-' : i.label);
    })()`);
    assert.deepEqual(
      helpItems.slice(-4),
      [`${BRAND.displayName} Guide`, '-', 'Report a Bug…', 'Request a Feature…'],
      'Help ends with the Guide and the two items',
    );
    let count = (await opened()).length;
    // Once the setup check at start has found the fake claude's version.
    let report = '';
    for (const end = Date.now() + 10_000; Date.now() < end; await sleep(200)) {
      await clickMenuItem(mainProcess, 'Report a Bug…');
      report = await lastOpened(++count, 'Report a Bug…');
      if (new URL(report).searchParams.get('claude-version')) break;
    }
    checkBugReport(report, 'Report a Bug…');
    await clickMenuItem(mainProcess, 'Request a Feature…');
    assert.equal(
      await lastOpened(++count, 'Request a Feature…'),
      `${NEW_ISSUE}?template=feature_request.yml`,
    );
    // The same from the Guide's Troubleshooting page.
    await page.eval(`document.querySelector('[data-guide-tab]').click()`);
    await page.waitFor(`!!document.querySelector('[data-guide-search]')`, 'the Guide');
    await page.eval(`document.querySelector('[data-guide-search]').focus()`);
    await page.send('Input.insertText', { text: 'Request a Feature' });
    await page.waitFor(
      `!!document.querySelector('[data-guide-result="troubleshooting"]')`,
      'the Troubleshooting result',
    );
    await page.eval(`document.querySelector('[data-guide-result="troubleshooting"]').click()`);
    await page.waitFor(
      `!!document.querySelector('[data-guide-link="app:report-bug"]')`,
      'the Guide links',
    );
    assert.match(
      await page.eval<string>(`document.querySelector('[data-guide-article]').innerText`),
      /Nothing is sent/,
    );
    await page.eval(`document.querySelector('[data-guide-link="app:report-bug"]').click()`);
    checkBugReport(await lastOpened(++count, 'the Guide bug link'), 'the Guide bug link');
    await page.eval(`document.querySelector('[data-guide-link="app:request-feature"]').click()`);
    assert.equal(
      await lastOpened(++count, 'the Guide feature link'),
      `${NEW_ISSUE}?template=feature_request.yml`,
    );
    await quit(running);

    // 4. After a restart: no question; the check at start skips 99.0.0 but offers 100.0.0.
    endpoint.status = 200;
    endpoint.tag = 'v99.0.0';
    const before = endpoint.requests.length;
    running = await launch();
    ({ page, main: mainProcess } = running);
    await waitUntil('the check at start', () => endpoint.requests.length > before);
    await sleep(1000);
    assert.equal(await page.eval(`!!document.querySelector('[data-update-ask]')`), false);
    assert.equal(await page.eval(`!!${notice}`), false, 'the skipped version stays skipped');
    await quit(running);
    endpoint.tag = 'v100.0.0';
    running = await launch();
    ({ page } = running);
    await page.waitFor(`${notice}?.dataset.updateNotice === '100.0.0'`, 'a newer version');
    await quit(running);
    console.log(`e2e updates test passed (${devMode ? 'dev server' : 'production build'})`);
  } finally {
    await (app as RunningApp | undefined)?.stop();
    fx.cleanup();
    server.close();
  }
}

main().catch((error) => {
  console.error(`e2e updates test failed: ${error instanceof Error ? error.stack : error}`);
  process.exit(1);
});
