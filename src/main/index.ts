import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BRAND, envVar } from '@shared/brand';
import { parseRateLimits } from '@shared/usage';
import { app, BrowserWindow, dialog, shell } from 'electron';
import { HookBridge } from './bridge/server';
import { FinishService, PR_POLL_MS } from './changes/finish';
import { claudeSettings, writeClaudeSettings } from './claude/settings';
import { awaitLastResponse } from './claude/transcript';
import { ConfigStore } from './config/store';
import { openStateDb } from './db/state-db';
import { UsageRecords } from './db/usage';
import { WorkspaceRecords } from './db/workspaces';
import { EditorService } from './editor/service';
import { EnvService } from './env/service';
import { helperPath, stableHelper, writeSessionBin } from './helper-files';
import {
  migrateSettings,
  noticeShown,
  pendingNotice,
  type SettingsMigration,
} from './legacy/settings';
import { installAppMenu } from './menu';
import { markShown, wasShown } from './notices';
import { appConfigDir, contractHome } from './paths';
import { installSecurityPolicies } from './security';
import { isSelfTest, runSelfTest } from './self-test';
import { CliLinkService } from './services/cli-link';
import { ProfileService } from './services/profiles';
import { ProjectService } from './services/projects';
import { TerminalService } from './services/terminals';
import { WorkspaceService } from './services/workspaces';
import { SessionHost } from './sessions/host';
import { SetupService } from './setup/service';
import { SkillService } from './skills/service';
import { ElectronStatusPlatform } from './status/electron';
import { StatusService } from './status/service';
import { serveTrpcOverIpc } from './trpc/electron';
import { createMainWindow, devIconPath } from './window';
import { TaskLookupService } from './workflow/lookup';
import { WorkflowSetupService } from './workflow/propose';
import { WorkflowService } from './workflow/service';
import { WorktreeNotices } from './worktrees/notices';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Name and paths must be set before `ready`, so Electron's defaults (derived from
// package.json) are never used.
app.setName(BRAND.displayName);
// The self-test runs against a throwaway config dir, never the user's. Scripted
// tests that need the user's real HOME (to reach their Claude login) point the
// app at a separate config dir with <PREFIX>CONFIG_DIR.
const configOverride = process.env[envVar('CONFIG_DIR')];
let configDir = isSelfTest
  ? fs.mkdtempSync(path.join(os.tmpdir(), `${BRAND.slug}-self-test-`))
  : path.resolve(configOverride || appConfigDir());
// The first start after the rename copies the old app's settings (spec §3.5),
// before Electron creates the folder. While the old app runs nothing is copied,
// and this start uses a throwaway folder only to say so and quit.
const migration: SettingsMigration =
  isSelfTest || configOverride
    ? { kind: 'none' }
    : migrateSettings(appConfigDir(undefined, BRAND.legacy), configDir);
if (migration.kind === 'old-app-running') {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), `${BRAND.slug}-waiting-`));
}
app.setPath('userData', configDir);
app.setPath('sessionData', path.join(configDir, 'session'));
if (process.platform === 'win32') app.setAppUserModelId(BRAND.bundleId);

let mainWindow: BrowserWindow | null = null;
let env: EnvService;
const host = new SessionHost();
const bridge = new HookBridge();
let status: StatusService | null = null;
let statusPlatform: ElectronStatusPlatform | null = null;
/** The quit dialog in the window (spec §5): asked with the busy session ids. */
const quitAsker = new EventEmitter();
let answerQuit: ((quit: boolean) => void) | null = null;
/** The notice in the window when it first closes and the app keeps running (spec §5). */
const closeNoticeAsker = new EventEmitter();
let answerCloseNotice: ((close: boolean) => void) | null = null;
/** Set once the app is ready: the config and its folder, for closing the window. */
let appConfig: ConfigStore | null = null;
let appDataDir: string | null = null;
/** A quit is under way: windows close without the notice or another question. */
let quitting = false;

/** The helper as hooks run it, for the self-test. */
let helperForSelfTest: string | null = null;

/** Main-process checks for --self-test; returns a problem description or null. */
async function selfTestCheck(): Promise<string | null> {
  // Packaged builds (scripts/linux-package-check.sh): the helper, outside the
  // asar or copied out of the AppImage, runs. state.db already opened, so
  // better-sqlite3 loads.
  if (app.isPackaged) {
    if (!helperForSelfTest) return `${BRAND.helperCommand} is missing`;
    try {
      execFileSync(helperForSelfTest, ['--version'], { stdio: 'ignore', timeout: 5000 });
    } catch (error) {
      return `${helperForSelfTest} --version failed: ${String(error)}`;
    }
  }
  const diagnostics = await env.diagnostics();
  if (diagnostics.source !== 'login-shell') return `login shell env: ${diagnostics.error}`;
  if (!diagnostics.git) return 'git not found on the login shell PATH';

  const session = host.spawn({
    kind: 'shell',
    title: 'self-test',
    command: '/bin/sh',
    args: ['-c', 'printf pty-$((40 + 2))'],
    cwd: os.tmpdir(),
    env: (await env.login()).env,
    profileId: 'self-test',
  });
  for (let i = 0; i < 50 && host.get(session.id).status === 'running'; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!host.scrollback(session.id).includes('pty-42')) {
    return `PTY output missing: ${JSON.stringify(host.scrollback(session.id))}`;
  }
  await host.remove(session.id);
  return null;
}

function showMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    return;
  }
  const win = createMainWindow();
  mainWindow = win;
  statusPlatform?.track(win);
  win.on('close', (event) => onWindowClose(win, event));
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
    answerCloseNotice = null;
  });
  if (isSelfTest) runSelfTest(mainWindow, selfTestCheck);
}

/**
 * Closing the window (spec §5). On macOS the app keeps running, so Claude
 * finishes and notifications arrive, and says so in the window the first time
 * ever. On Linux and Windows, or with Quit When the Window Closes, closing quits
 * instead: through app.quit, which asks first while something runs, with the
 * window still there to ask in.
 */
function onWindowClose(win: BrowserWindow, event: Electron.Event): void {
  if (quitting || isSelfTest) return;
  if (process.platform !== 'darwin' || appConfig?.get().config?.quitOnWindowClose) {
    event.preventDefault();
    app.quit();
    return;
  }
  if (!appDataDir || wasShown(appDataDir, 'window-closed')) return;
  if (closeNoticeAsker.listenerCount('request') === 0) return;
  event.preventDefault();
  // Never shown again, whatever the answer.
  markShown(appDataDir, 'window-closed');
  void new Promise<boolean>((resolve) => {
    answerCloseNotice = resolve;
    closeNoticeAsker.emit('request');
  }).then((close) => {
    answerCloseNotice = null;
    if (close && !win.isDestroyed()) win.close();
  });
}

/** Once, after the settings were copied: where the old folder still is (spec §3.5). */
function showMigrationNotice(dataDir: string): void {
  const from = pendingNotice(dataDir);
  if (!from || !mainWindow) return;
  noticeShown(dataDir);
  const reveal = process.platform === 'darwin' ? 'Show in Finder' : 'Show in folder';
  void dialog
    .showMessageBox(mainWindow, {
      type: 'info',
      message: `Your settings were copied from ${BRAND.legacy.displayName}`,
      detail: `${BRAND.displayName} keeps its settings in ${contractHome(dataDir)}. ${BRAND.legacy.displayName}'s folder, ${contractHome(from)}, is still there, unchanged, as a backup. Delete it once everything works.`,
      buttons: ['OK', reveal],
      defaultId: 0,
    })
    .then(({ response }) => {
      if (response === 1) void shell.openPath(from);
    });
}

if (!isSelfTest && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);

  app.whenReady().then(async () => {
    if (migration.kind === 'old-app-running') {
      await dialog.showMessageBox({
        type: 'info',
        message: `Quit ${BRAND.legacy.displayName} first`,
        detail: `${BRAND.displayName} copies ${BRAND.legacy.displayName}'s settings and workspaces when it first starts, and ${BRAND.legacy.displayName} is still running. Quit ${BRAND.legacy.displayName}, then open ${BRAND.displayName} again.`,
      });
      fs.rmSync(configDir, { recursive: true, force: true });
      app.exit(0);
      return;
    }
    const dataDir = app.getPath('userData');
    if (!app.isPackaged && fs.existsSync(devIconPath())) app.dock?.setIcon(devIconPath());
    // The hook bridge (spec §10.1) and cli.json for the command line tool (§7.5).
    await bridge.start();
    const cliFile = path.join(dataDir, 'cli.json');
    bridge.writeCliFile(cliFile);
    app.on('will-quit', () => {
      fs.rmSync(cliFile, { force: true });
      void bridge.stop();
    });
    const bundled = helperPath({
      appPath: app.getAppPath(),
      resourcesPath: app.isPackaged ? process.resourcesPath : null,
    });
    const helper = bundled && stableHelper(bundled, dataDir, process.env.APPIMAGE);
    helperForSelfTest = helper;
    if (!helper) console.warn(`${BRAND.helperCommand} is missing: run npm run build:helper`);
    const config = new ConfigStore(path.join(dataDir, 'config.json'));
    config.load();
    appConfig = config;
    appDataDir = dataDir;
    const db = openStateDb(path.join(dataDir, 'state.db'));
    app.on('will-quit', () => db.close());
    env = new EnvService(config);

    installSecurityPolicies();
    const menuRequests = new EventEmitter();
    installAppMenu(config, (what) => {
      showMainWindow();
      menuRequests.emit('request', what);
    });
    const workspaceRecords = new WorkspaceRecords(db);
    // Workspace states from hooks (spec §10), their alerts and the Dock badge.
    statusPlatform = new ElectronStatusPlatform(config);
    status = new StatusService(workspaceRecords, host, statusPlatform);
    bridge.onHook((message) => status?.handleHook(message));
    // Plan usage from the status line (spec §11).
    const usage = new UsageRecords(db);
    bridge.onStatusLine(({ profileId, rateLimits }) => {
      const snapshot = parseRateLimits(rateLimits);
      if (profileId && snapshot && config.get().config?.profiles.some((p) => p.id === profileId)) {
        usage.save(profileId, snapshot);
      }
    });
    statusPlatform.onOpen(() => showMainWindow());
    // Prompt markers and Copy buttons in Claude tabs (spec §6.8): each event is
    // marked in the Claude session's output, a response with its text from the
    // transcript once it is written there (after the Stop hook).
    status.onConversation(async ({ workspaceId, event, text, transcript }) => {
      const claude = () =>
        host
          .list()
          .find(
            (s) => s.workspaceId === workspaceId && s.kind === 'claude' && s.status === 'running',
          );
      if (event === 'UserPromptSubmit') {
        const session = claude();
        if (session) host.mark(session.id, { kind: 'prompt', text });
        return;
      }
      const file = transcript ?? workspaceRecords.transcriptPath(workspaceId);
      const response = file ? await awaitLastResponse(file, text) : text?.trim() || null;
      const session = claude();
      if (session && response) host.mark(session.id, { kind: 'response', text: response });
    });
    const terminals = new TerminalService(config, env, host);
    terminals.additions = {
      env: { [envVar('BRIDGE_URL')]: bridge.url, [envVar('BRIDGE_TOKEN')]: bridge.token },
      pathDirs: helper ? [writeSessionBin(dataDir, helper)] : [],
    };
    // Skill sources (spec §13.2): plugin folders for every session of a profile.
    const skills = new SkillService(config, env, dataDir);
    terminals.skills = skills;
    host.onExit((info) => {
      if (info.kind === 'claude' && info.workspaceId) skills.claudeStopped(info.workspaceId);
    });
    const setup = new SetupService(config, env, terminals);
    terminals.claudeGate = setup;
    setup.checkAll();
    app.on('browser-window-focus', () => setup.checkUnpassedOnFocus());
    const projects = new ProjectService(config, env);
    // Two --settings files: with and without the ask rule for `<slug> link`,
    // per the profile's Ask before Claude links a repository (spec §21.9).
    const settingsOptions = {
      helper,
      // Dev flag for the §9.3 live check: the injected hooks write markers there.
      markersDir: process.env[envVar('SMOKE_MARKERS')] || undefined,
    };
    // Dev flag for the Copy buttons' live check (spec §6.8): Claude's
    // renderer, "default" or "fullscreen", over the profile's own setting.
    const smokeTui = process.env[envVar('SMOKE_TUI')];
    const withTui = (settings: Record<string, unknown>) =>
      smokeTui ? { ...settings, tui: smokeTui } : settings;
    const plainSettings = writeClaudeSettings(dataDir, withTui(claudeSettings(settingsOptions)));
    const askLinkSettings = writeClaudeSettings(
      dataDir,
      withTui(claudeSettings({ ...settingsOptions, askBeforeLink: true })),
      'settings-ask-link.json',
    );
    const workspaces = new WorkspaceService(
      config,
      env,
      workspaceRecords,
      terminals,
      (profileId) =>
        env?.profile(profileId).claude.askBeforeLink === false ? plainSettings : askLinkSettings,
    );
    // The workflow read from each workspace's status file (spec §13.4, §13.5).
    const workflow = new WorkflowService(config, workspaceRecords, terminals);
    status.workflow = workflow;
    workflow.lookups = new TaskLookupService((profileId, projectId) =>
      terminals.lookupContext(profileId, projectId),
    );
    // Set up from my skills (spec §13.10).
    const workflowSetup = new WorkflowSetupService(config, workspaceRecords, skills, (p, q) =>
      terminals.lookupContext(p, q),
    );
    workflow.onChange(({ workspaceId, before, after }) =>
      status?.workflowChanged(workspaceId, before, after),
    );
    workspaces.startPrompt = (workspace) => workflow.startPrompt(workspace);
    workspaces.adoptPrefill = (projectId, worktree, branch) =>
      workflow.prefill(projectId, worktree, branch);
    // Worktrees made outside the app, by a skill or by hand (spec §13.6).
    const worktreeNotices = new WorktreeNotices(config, workspaces);
    void worktreeNotices.start();
    app.on('browser-window-focus', () => worktreeNotices.focused());
    app.on('will-quit', () => worktreeNotices.dispose());
    app.on('browser-window-focus', () => workflow.refreshAll());
    app.on('will-quit', () => {
      workflow.dispose();
      workflow.lookups?.dispose();
      workflowSetup.dispose();
    });
    // The command line tool (spec §7.5, §21.9).
    const cliLink = new CliLinkService(config, workspaceRecords, projects, workspaces);
    bridge.handleCli({
      add: (request) => projects.addFromCli(request),
      link: (request) => cliLink.link(request),
      projects: (request) => cliLink.projectList(request),
      sessionNote: (workspaceId) => cliLink.sessionNote(workspaceId),
    });
    // PR status (spec §12.4): every 5 minutes, and when the window gains focus.
    const finish = new FinishService(config, workspaceRecords, terminals);
    const prTimer = setInterval(() => void finish.refreshAll(), PR_POLL_MS);
    app.on('will-quit', () => clearInterval(prTimer));
    let lastFocusCheck = 0;
    app.on('browser-window-focus', () => {
      if (Date.now() - lastFocusCheck < 60_000) return;
      lastFocusCheck = Date.now();
      void finish.refreshAll();
    });
    // Open in editor (spec §6.13), in the profile's environment.
    const editors = new EditorService(
      config,
      async (profileId, projectId) => {
        const context = await terminals.lookupContext(profileId, projectId);
        return { env: context.env, shell: context.shell };
      },
      dataDir,
    );
    serveTrpcOverIpc({
      finish,
      editors,
      quit: { asker: quitAsker, answer: (quit: boolean) => answerQuit?.(quit) },
      closeNotice: {
        asker: closeNoticeAsker,
        answer: (close: boolean) => answerCloseNotice?.(close),
      },
      menuRequests,
      helper,
      usage,
      status,
      statusPlatform,
      setup,
      profiles: new ProfileService(config, env),
      config,
      db,
      workspaceRecords,
      env,
      projects,
      terminals,
      workspaces,
      cliLink,
      skills,
      workflow,
      workflowSetup,
      worktreeNotices,
    });
    showMainWindow();
    showMigrationNotice(dataDir);
    void workspaces.resumeAtLaunch();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) showMainWindow();
    });
  });

  // Sessions keep running without windows (spec §5). Quitting (⌘Q, the app
  // menu's and the Dock's Quit, closing the window where that quits) asks first
  // when it would interrupt something (the §5 count), then stops everything and
  // quits completely.
  let stopped = false;
  let asking = false;
  // A SIGTERM (logout, a test runner) quits without asking: nobody is there to answer.
  let askBeforeQuit = true;
  // Chromium installs its own SIGTERM handler during startup, which quits like
  // ⌘Q (and so asks); this one replaces it once the app is ready.
  app.whenReady().then(() => {
    process.removeAllListeners('SIGTERM');
    process.on('SIGTERM', () => {
      askBeforeQuit = false;
      app.quit();
    });
  });
  app.on('before-quit', (event) => {
    if (stopped || host.runningCount() === 0) {
      quitting = true;
      // Nothing cancels the quit from here: no session may start (spec §5).
      host.close();
      return;
    }
    event.preventDefault();
    // ⌘Q again while the dialog asks confirms it (components.md: Quit is ⌘Q).
    if (asking) {
      answerQuit?.(true);
      return;
    }
    void (async () => {
      const busySessions = host.busySessions();
      const busy = busySessions.length;
      if (busy > 0 && askBeforeQuit && quitAsker.listenerCount('request') > 0 && mainWindow) {
        // The design's dialog in the window, listing each session (spec §5).
        asking = true;
        mainWindow.show();
        const quit = await new Promise<boolean>((resolve) => {
          answerQuit = resolve;
          quitAsker.emit(
            'request',
            busySessions.map((s) => s.id),
          );
        }).finally(() => {
          asking = false;
          answerQuit = null;
        });
        if (!quit) return;
      } else if (busy > 0 && askBeforeQuit) {
        asking = true;
        const sessions = plural(busy, 'running session');
        const options = {
          type: 'warning' as const,
          message: `Stop ${sessions}?`,
          detail: `Quitting stops ${busy === 1 ? 'it' : 'them'}. Claude conversations can be resumed later.`,
          buttons: ['Quit', 'Cancel'],
          defaultId: 0,
          cancelId: 1,
        };
        const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
        const { response } = await (parent
          ? dialog.showMessageBox(parent, options)
          : dialog.showMessageBox(options)
        ).finally(() => {
          asking = false;
        });
        if (response !== 0) return;
      }
      if (status) status.quitting = true;
      host.close();
      await host.stopAll();
      stopped = true;
      app.quit();
    })();
  });

  // Closing the window quits on Linux and Windows (onWindowClose); this covers a
  // window that went away without a close event.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
