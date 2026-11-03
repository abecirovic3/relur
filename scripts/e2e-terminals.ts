/**
 * End-to-end test of switching terminals (spec §6.3, §6.8): two workspaces
 * whose Claude tabs have different prompt markers, switched back and forth
 * with the project view in between, in a wide and a narrow window and in
 * Claude's full-screen mode. After every switch the page has one terminal,
 * every prompt marker shown is that terminal's own (one of its numbers,
 * never another workspace's), and the terminal was repainted when shown.
 * Runs with a throwaway HOME and a fake `claude`.
 *
 *   tsx scripts/e2e-terminals.ts [--dev] [--screenshots=<dir>] [extra Electron args…]
 */
import './lib/clean-env';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { appConfigDir } from '../src/main/paths';
import { createFixture } from '../src/main/test-support/git-fixtures';
import { SEED_CONFIG } from '../src/main/test-support/seed-config';
import {
  clickLabel,
  launchApp,
  type RunningApp,
  screenshot,
  sleep,
  submitDialog,
  typeInField,
  typeInTerminal,
  withDisplayEnv,
} from './lib/app-driver';

const args = process.argv.slice(2);
const screenshotDir = args.find((a) => a.startsWith('--screenshots='))?.split('=')[1];
const devMode = args.includes('--dev');
const electronArgs = args.filter((a) => !a.startsWith('--screenshots=') && a !== '--dev');

/** What the page shows: its terminals, and each visible prompt marker with its terminal. */
interface Shown {
  title: string | null;
  terminals: number;
  terminal: string | null;
  repaints: number;
  marks: { n: string; terminal: string | null }[];
}

const shownJs = `(() => {
  const terminals = [...document.querySelectorAll('[data-terminal]')];
  const shown = terminals.find((t) => t.offsetParent) ?? null;
  const marks = [...document.querySelectorAll('[data-prompt-mark]')]
    .filter((m) => m.style.display !== 'none' && m.offsetParent)
    .map((m) => ({ n: m.dataset.promptMark, terminal: m.closest('[data-terminal]')?.dataset.terminal ?? null }));
  return {
    title: document.querySelector('h1')?.textContent ?? null,
    terminals: terminals.length,
    terminal: shown?.dataset.terminal ?? null,
    repaints: Number(shown?.dataset.repaints ?? 0),
    marks,
  };
})()`;

async function main() {
  const fx = createFixture();
  let app: RunningApp | undefined;
  try {
    const { clone: repo } = fx.cloneWithRemote('api', 'main');
    fs.writeFileSync(path.join(fx.root, '.zshrc'), '');
    // A stand-in for Claude: a line `p <text>` is a prompt (printed, then the
    // UserPromptSubmit hook, then an answer); `fullscreen` and `classic`
    // enter and leave the alternate screen. Scripted tests never start the real one.
    const fakeClaude = path.join(fx.root, 'bin', 'fake-claude');
    fs.mkdirSync(path.dirname(fakeClaude));
    fs.writeFileSync(
      fakeClaude,
      `#!/bin/sh
case "$1" in
  --version) echo '9.9.9 (Claude Code)'; exit 0 ;;
  auth) printf '{"loggedIn":true,"email":"test@example.com","configDirectory":"%s"}\\n' "\${CLAUDE_CONFIG_DIR:-$HOME/.claude}"; exit 0 ;;
esac
settings=""; prev=""
for arg in "$@"; do [ "$prev" = --settings ] && settings="$arg"; prev="$arg"; done
helper=$(sed -n "s/.*\\"command\\": \\"'\\(.*\\)' hook SessionStart\\".*/\\1/p" "$settings")
hook() { printf '%s' "$2" | "$helper" hook "$1"; }
hook SessionStart '{"session_id":"s","transcript_path":"/dev/null"}' > /dev/null
while IFS= read -r line; do
  case "$line" in
    p\\ *) t="\${line#p }"; printf '\\342\\235\\257 %s\\n' "$t"; hook UserPromptSubmit "{\\"prompt\\":\\"$t\\"}"
      i=0; while [ $i -lt 6 ]; do printf 'answer %s to %s\\n' $i "$t"; i=$((i+1)); done ;;
    fullscreen) printf '\\033[?1049h\\033[HFull screen\\n' ;;
    classic) printf '\\033[?1049l' ;;
  esac
done
exec sleep 600
`,
      { mode: 0o755 },
    );
    fs.writeFileSync(path.join(fx.root, '.claude.json'), '{}');
    fs.mkdirSync(path.join(fx.root, '.claude-personal'));
    fs.writeFileSync(path.join(fx.root, '.claude-personal', '.claude.json'), '{}');
    const configFile = path.join(
      appConfigDir({ platform: process.platform, env: {}, homeDir: fx.root }),
      'config.json',
    );
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(
      configFile,
      JSON.stringify({
        ...SEED_CONFIG,
        profiles: SEED_CONFIG.profiles.map((p) => ({
          ...p,
          claude: { command: fakeClaude, args: [] },
        })),
        projects: [
          {
            id: 'api',
            profileId: 'work',
            name: 'api',
            repoPath: repo,
            remote: 'origin',
            baseBranch: 'main',
          },
        ],
      }),
    );

    app = await launchApp({ env: withDisplayEnv(fx.env), dev: devMode, electronArgs });
    const { page, main: mainProcess } = app;
    const setSize = (width: number, height: number) =>
      mainProcess.eval(
        `process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].setSize(${width}, ${height})`,
      );
    await setSize(1600, 1000);
    await page.waitFor(`!!document.querySelector('[aria-label="New workspace in api"]')`, 'app');

    const newWorkspace = async (task: string, prompts: string[]) => {
      await clickLabel(page, 'New workspace in api');
      await page.waitFor(`!!document.querySelector('dialog[open] #ws-task')`, 'New workspace');
      await typeInField(page, '#ws-task', task, false);
      await sleep(600);
      await submitDialog(page);
      await page.waitFor(`!document.querySelector('dialog[open]')`, `${task} created`);
      for (const prompt of prompts) {
        await typeInTerminal(page, `p ${prompt}`);
        await sleep(300);
      }
      await page.waitFor(
        `!!document.querySelector('[data-prompt-mark="${prompts.length}"]')`,
        `${task}'s markers`,
      );
    };
    await newWorkspace('AAA-1 Alpha', ['first', 'second', 'third']);
    await newWorkspace('BBB-2 Beta', ['only']);

    const open = (title: string) =>
      page.eval(
        `[...document.querySelectorAll('nav button')].find((b) => (b.title || '').startsWith(${JSON.stringify(title)})).click()`,
      );
    const openProject = () =>
      page.eval(
        `[...document.querySelectorAll('nav li button')].find((b) => b.textContent === 'api').click()`,
      );
    const terminalOf: Record<string, string> = {};
    /**
     * Opens the workspace and checks what it shows once its terminal is
     * connected and repainted: only its own markers, with `expected` the
     * numbers it may show (all of them visible when `all`).
     */
    const check = async (title: string, name: string, expected: string[], all: boolean) => {
      await open(title);
      await page.waitFor(
        `(() => { const s = ${shownJs}; return s.title === ${JSON.stringify(name)} && s.repaints > 0 && !!document.querySelector('[data-terminal][data-connected]'); })()`,
        `${name} shown and repainted`,
      );
      // Markers are placed once the replay's lines are found.
      await sleep(200);
      const shown = await page.eval<Shown>(shownJs);
      assert.equal(shown.terminals, 1, `${name}: one terminal on the page`);
      terminalOf[name] ??= shown.terminal ?? '';
      assert.equal(shown.terminal, terminalOf[name], `${name}: its own session`);
      for (const mark of shown.marks) {
        assert.equal(mark.terminal, shown.terminal, `${name}: marker ${mark.n} is its own`);
        assert.ok(expected.includes(mark.n), `${name}: marker ${mark.n} is one of its numbers`);
      }
      const numbers = shown.marks.map((m) => m.n).sort();
      if (all) assert.deepEqual(numbers, expected, `${name}: all its markers`);
      return numbers;
    };

    // Wide: every marker in view. Quick switches, with the project view between.
    for (let round = 0; round < 4; round++) {
      await check('AAA-1', 'Alpha', ['1', '2', '3'], true);
      await check('BBB-2', 'Beta', ['1'], true);
      await openProject();
      await page.waitFor(`!document.querySelector('[data-terminal]')`, 'the project view');
    }
    for (let i = 0; i < 12; i++) {
      await open(i % 2 ? 'AAA-1' : 'BBB-2');
      await sleep(i % 3 ? 40 : 5);
    }
    await check('BBB-2', 'Beta', ['1'], true);
    await check('AAA-1', 'Alpha', ['1', '2', '3'], true);
    await screenshot(page, screenshotDir, 'terminals-1-wide.png');

    // Narrow: Alpha's early prompts scroll out of view; Beta still shows only its own 1.
    await setSize(820, 520);
    await sleep(800);
    const narrow = await check('AAA-1', 'Alpha', ['1', '2', '3'], false);
    assert.ok(narrow.includes('3'), 'the last prompt is in view');
    await check('BBB-2', 'Beta', ['1'], true);
    await check('AAA-1', 'Alpha', ['1', '2', '3'], false);
    await screenshot(page, screenshotDir, 'terminals-2-narrow.png');

    // A resize and a theme change repaint the shown terminal.
    const repaints = async () => (await page.eval<Shown>(shownJs)).repaints;
    let before = await repaints();
    await setSize(1600, 1000);
    await page.waitFor(`(${shownJs}).repaints > ${before}`, 'a repaint after the resize');
    before = await repaints();
    await mainProcess.eval(
      `process.mainModule.require('electron').nativeTheme.themeSource = 'light'`,
    );
    await page.waitFor(`(${shownJs}).repaints > ${before}`, 'a repaint after the theme change');
    await mainProcess.eval(
      `process.mainModule.require('electron').nativeTheme.themeSource = 'dark'`,
    );

    // Full screen in Alpha: no markers there, and Beta still shows its own.
    await check('AAA-1', 'Alpha', ['1', '2', '3'], true);
    await typeInTerminal(page, 'fullscreen');
    await page.waitFor(
      `document.querySelector('[data-terminal]')?.xterm.buffer.active.type === 'alternate'`,
      'the alternate screen',
    );
    await check('BBB-2', 'Beta', ['1'], true);
    assert.deepEqual(await check('AAA-1', 'Alpha', [], false), [], 'none in full screen');
    await screenshot(page, screenshotDir, 'terminals-3-full-screen.png');
    await typeInTerminal(page, 'classic');
    await page.waitFor(
      `document.querySelector('[data-terminal]')?.xterm.buffer.active.type === 'normal'`,
      'the normal screen',
    );
    await check('BBB-2', 'Beta', ['1'], true);
    await check('AAA-1', 'Alpha', ['1', '2', '3'], true);

    console.log(`e2e terminals test passed (${devMode ? 'dev server' : 'production build'})`);
  } catch (error) {
    if (app) {
      await screenshot(app.page, screenshotDir, 'terminals-failure.png').catch(() => {});
      const shown = await app.page.eval(shownJs).catch((e) => `unreadable: ${e}`);
      console.error(`shown: ${JSON.stringify(shown)}`);
      if (app.page.errors.length > 0) {
        console.error(`renderer errors:\n  ${app.page.errors.join('\n  ')}`);
      }
    }
    throw error;
  } finally {
    await app?.stop();
    fx.cleanup();
  }
}

main().catch((error) => {
  console.error(`e2e terminals test failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
