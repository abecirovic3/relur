import fs from 'node:fs';
import path from 'node:path';
import { appConfigDir } from '../main/paths';
import { BRAND, envVar } from '../shared/brand';

/** Where the command line tool writes; replaced in tests. */
export interface Output {
  out: (text: string) => void;
  err: (text: string) => void;
}

export const stdio: Output = {
  out: (t) => process.stdout.write(t),
  err: (t) => process.stderr.write(t),
};

/** Reads all of stdin as text. */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** The hook bridge of the app this process runs under (spec §10.1), or null outside one. */
export function bridgeFromEnv(env: NodeJS.ProcessEnv): { url: string; token: string } | null {
  const url = env[envVar('BRIDGE_URL')];
  const token = env[envVar('BRIDGE_TOKEN')];
  return url && token ? { url, token } : null;
}

/** POSTs JSON to the bridge; resolves with the response, or null on any failure. */
export async function post(
  bridge: { url: string; token: string },
  route: string,
  body: unknown,
  timeoutMs: number,
): Promise<Response | null> {
  try {
    return await fetch(`${bridge.url}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bridge.token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
}

/** The app's bridge: the session's own inside its terminals, else cli.json (spec §7.5). */
export function findBridge(
  env: NodeJS.ProcessEnv,
): { url: string; token: string; file: string | null } | null {
  const own = bridgeFromEnv(env);
  if (own) return { ...own, file: null };
  const dir =
    env[envVar('CONFIG_DIR')] ||
    appConfigDir({ platform: process.platform, env, homeDir: env.HOME ?? '' });
  const file = path.join(dir, 'cli.json');
  try {
    const { url, token } = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      url?: unknown;
      token?: unknown;
    };
    return typeof url === 'string' && typeof token === 'string' ? { url, token, file } : null;
  } catch {
    return null;
  }
}

/**
 * A command line tool request to the running app: its JSON answer, or exit
 * code 2 after saying the app can't be reached (removing a stale cli.json).
 */
export async function callApp<T>(
  env: NodeJS.ProcessEnv,
  route: string,
  body: unknown,
  timeoutMs: number,
  { err }: Output,
): Promise<T | 2> {
  const bridge = findBridge(env);
  if (!bridge) {
    err(`${BRAND.displayName} isn't running. Start it, then run this again.\n`);
    return 2;
  }
  const response = await post(bridge, route, body, timeoutMs);
  if (!response?.ok) {
    // Left behind by a crash: no app answers there (spec §7.5).
    if (bridge.file) fs.rmSync(bridge.file, { force: true });
    err(
      `${BRAND.displayName} isn't running, or can't be reached. Start it, then run this again.\n`,
    );
    return 2;
  }
  const result = (await response.json().catch(() => null)) as T | null;
  if (!result) {
    err('Unexpected answer from the app\n');
    return 2;
  }
  return result;
}
