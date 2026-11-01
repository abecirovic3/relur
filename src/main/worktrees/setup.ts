import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BRAND } from '@shared/brand';
import type { Project } from '@shared/schemas';
import { shellQuote } from '@shared/shell';
import type { SetupPlan } from '@shared/workspaces';
import { z } from 'zod';

/** The repository's own setup file, relative to its root (spec §8.3). */
export const REPO_CONFIG = `${BRAND.repoDirName}/config.json`;
/** The old app's name for it, still read when the new one doesn't exist (spec §3.5). */
export const LEGACY_REPO_CONFIG = `${BRAND.legacy.repoDirName}/config.json`;

export const DEFAULT_PORTS = 10;
export const DEFAULT_SETUP_TIMEOUT_SEC = 900;
export const DEFAULT_TEARDOWN_TIMEOUT_SEC = 120;

const platformKey = { darwin: 'macos', linux: 'linux', win32: 'windows' } as Record<string, string>;

/** A list of commands, or per-OS lists: `{ "default": […], "windows": […] }`. */
const Commands = z.union([
  z.array(z.string().min(1)),
  z
    .object({
      default: z.array(z.string().min(1)).optional(),
      macos: z.array(z.string().min(1)).optional(),
      linux: z.array(z.string().min(1)).optional(),
      windows: z.array(z.string().min(1)).optional(),
    })
    .strict(),
]);

const RepoConfigSchema = z.object({
  setup: Commands.optional(),
  teardown: Commands.optional(),
  ports: z.number().int().min(1).max(100).optional(),
  setupTimeoutSec: z.number().int().positive().optional(),
  teardownTimeoutSec: z.number().int().positive().optional(),
  startClaude: z.enum(['after-setup', 'parallel']).optional(),
});

function forPlatform(commands: z.infer<typeof Commands> | undefined, platform: string): string[] {
  if (!commands) return [];
  if (Array.isArray(commands)) return commands;
  const key = platformKey[platform] as keyof typeof commands;
  return commands[key] ?? commands.default ?? [];
}

/**
 * What runs when a workspace is set up and torn down (spec §8.3): the
 * repository's `.<slug>/config.json` in `dir` when it has one (or the old
 * app's name for it, §3.5), otherwise the project's commands kept in the app,
 * otherwise nothing. A repository file
 * that can't be read is reported in `error` and runs nothing.
 */
export function setupPlan(project: Project, dir: string, platform = process.platform): SetupPlan {
  const rel = [REPO_CONFIG, LEGACY_REPO_CONFIG].find((f) => fs.existsSync(path.join(dir, f)));
  const base = {
    ports: DEFAULT_PORTS,
    setupTimeoutSec: DEFAULT_SETUP_TIMEOUT_SEC,
    teardownTimeoutSec: DEFAULT_TEARDOWN_TIMEOUT_SEC,
    startClaude: 'after-setup' as const,
    error: null,
  };
  if (rel) {
    let parsed: z.infer<typeof RepoConfigSchema>;
    try {
      parsed = RepoConfigSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8')));
    } catch (error) {
      const message =
        error instanceof z.ZodError
          ? error.issues.map((i) => `${i.path.join('.') || 'file'}: ${i.message}`).join('; ')
          : error instanceof Error
            ? error.message
            : String(error);
      return {
        ...base,
        source: 'repo',
        file: rel,
        setup: [],
        teardown: [],
        error: `${rel}: ${message}`,
      };
    }
    return {
      ...base,
      source: 'repo',
      file: rel,
      setup: forPlatform(parsed.setup, platform),
      teardown: forPlatform(parsed.teardown, platform),
      ports: parsed.ports ?? base.ports,
      setupTimeoutSec: parsed.setupTimeoutSec ?? base.setupTimeoutSec,
      teardownTimeoutSec: parsed.teardownTimeoutSec ?? base.teardownTimeoutSec,
      startClaude: parsed.startClaude ?? base.startClaude,
    };
  }
  const own = project.setup;
  if (own && (own.setup.length > 0 || own.teardown.length > 0 || own.ports)) {
    return {
      ...base,
      source: 'app',
      setup: own.setup,
      teardown: own.teardown,
      ports: own.ports ?? base.ports,
      startClaude: own.startClaude ?? base.startClaude,
    };
  }
  return { ...base, source: null, setup: [], teardown: [] };
}

/**
 * A POSIX shell script that runs `commands` in order, each in a subshell,
 * showing each one, and stops at the first that fails with its exit code. `label` names the step
 * in the closing line ("Setup finished", "Setup failed (exit 1)").
 */
export function commandScript(commands: string[], label: string): string {
  const steps = commands.map(
    (command) => `printf '\\033[2m$ %s\\033[0m\\n' ${shellQuote(command)} && (\n${command}\n)`,
  );
  return [
    `${steps.join(' && ')} || { code=$?; printf '\\n\\033[31m✕ ${label} failed (exit %s)\\033[0m\\n' "$code"; exit "$code"; }`,
    `printf '\\n\\033[32m✓ ${label} finished\\033[0m\\n'`,
  ].join('\n');
}

/**
 * The lowest free block of `count` ports in `range` (spec §8.4), aligned to
 * `count` from the start of the range so blocks line up.
 */
export function allocatePorts(
  count: number,
  range: { start: number; end: number },
  taken: { base: number; count: number }[],
): { base: number; count: number } {
  for (let base = range.start; base + count - 1 <= range.end; base += count) {
    const end = base + count - 1;
    if (taken.every((t) => end < t.base || base > t.base + t.count - 1)) return { base, count };
  }
  throw new Error(`No free block of ${count} ports left in ${range.start}–${range.end}`);
}

export interface CommandResult {
  ok: boolean;
  /** The last lines of its output, for showing a failure. */
  output: string;
  message: string;
}

/**
 * Runs commands without a terminal (teardown, spec §8.3): through the user's
 * shell in `cwd`, stopped after `timeoutSec`.
 */
export function runCommands(options: {
  shell: string;
  commands: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutSec: number;
  label: string;
}): Promise<CommandResult> {
  const { shell, commands, cwd, env, timeoutSec, label } = options;
  return new Promise((resolve) => {
    execFile(
      shell,
      ['-c', commandScript(commands, label)],
      { cwd, env, timeout: timeoutSec * 1000, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const output = `${stdout}${stderr}`
          // biome-ignore lint/suspicious/noControlCharactersInRegex: strips color codes
          .replace(/\x1b\[[0-9;]*m/g, '')
          .trim()
          .split('\n')
          .slice(-15)
          .join('\n');
        if (!error) return resolve({ ok: true, output, message: `${label} finished` });
        const timedOut = (error as { killed?: boolean }).killed;
        resolve({
          ok: false,
          output,
          message: timedOut
            ? `${label} timed out after ${timeoutSec} s`
            : `${label} failed (exit ${typeof error.code === 'number' ? error.code : '?'})`,
        });
      },
    );
  });
}
