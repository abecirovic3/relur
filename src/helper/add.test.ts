import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
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

describe('helper add --new and --clone (spec §7.5)', () => {
  let server: http.Server;
  let requests: Record<string, unknown>[];
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    requests = [];
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        requests.push(parsed);
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            ok: true,
            project: { id: 'p', profileId: 'work', repoPath: parsed.path, baseBranch: 'main' },
          }),
        );
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    env = {
      [envVar('BRIDGE_URL')]: `http://127.0.0.1:${port}`,
      [envVar('BRIDGE_TOKEN')]: 't',
      [envVar('PROFILE')]: 'work',
    };
  });
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  it('sends --new to the app with the checkboxes', async () => {
    expect(await runAdd(['--new', 'fresh', '--no-readme'], env, dir, io)).toBe(0);
    expect(requests[0]).toMatchObject({
      path: path.join(dir, 'fresh'),
      create: { readme: false, gitignore: true },
    });
    expect(await runAdd(['--new'], env, dir, io)).toBe(1);
    expect(await runAdd(['--no-readme'], env, dir, io)).toBe(1);
    expect(await runAdd(['--new', 'a', '--all'], env, dir, io)).toBe(1);
  });

  it('clones in this terminal first, into the folder named by the URL, then adds it', async () => {
    const cloned: string[][] = [];
    const cloner = async (url: string, target: string) => {
      cloned.push([url, target]);
      fs.mkdirSync(target);
      return 0;
    };
    expect(await runAdd(['--clone', 'git@host.example:team/shop.git'], env, dir, io, cloner)).toBe(
      0,
    );
    expect(cloned).toEqual([['git@host.example:team/shop.git', path.join(dir, 'shop')]]);
    expect(requests[0]).toMatchObject({ path: path.join(dir, 'shop'), create: null });
    expect(out).toMatch(/^Added p to work/);

    expect(await runAdd(['--clone', 'x/api.git', 'elsewhere'], env, dir, io, cloner)).toBe(0);
    expect(cloned[1]?.[1]).toBe(path.join(dir, 'elsewhere'));
  });

  it('adds nothing when the clone fails or the folder is taken', async () => {
    const failing = async () => 128;
    expect(await runAdd(['--clone', 'x/broken.git'], env, dir, io, failing)).toBe(1);
    expect(err).toMatch(/git clone failed \(exit 128\); nothing was added/);
    fs.mkdirSync(path.join(dir, 'taken'));
    fs.writeFileSync(path.join(dir, 'taken', 'f'), '');
    let ran = false;
    const never = async () => {
      ran = true;
      return 0;
    };
    expect(await runAdd(['--clone', 'x/taken.git'], env, dir, io, never)).toBe(1);
    expect(ran).toBe(false);
    expect(requests).toEqual([]);
  });

  it("doesn't clone when the app isn't running or no profile is known", async () => {
    let ran = false;
    const never = async () => {
      ran = true;
      return 0;
    };
    expect(
      await runAdd(['--clone', 'x/a.git'], { [envVar('CONFIG_DIR')]: dir }, dir, io, never),
    ).toBe(2);
    const noProfile = { ...env, [envVar('PROFILE')]: undefined };
    expect(await runAdd(['--clone', 'x/a.git'], noProfile, dir, io, never)).toBe(1);
    expect(err).toMatch(/--profile/);
    expect(ran).toBe(false);
  });
});
