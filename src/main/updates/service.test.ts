import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UPDATE_INTERVAL_MS } from '@shared/updates';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { skippedStore, type UpdateDeps, UpdateService } from './service';

const latest = (tag: string, fields: Record<string, unknown> = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/o/r/releases/tag/${tag}`,
  assets: [],
  ...fields,
});

let answer: unknown;
let fail: string | null;
let calls: number;
let automatic: boolean | undefined;
let skipped: string | null;

function service() {
  const deps: UpdateDeps = {
    version: '0.1.0',
    fetchLatest: async () => {
      calls++;
      if (fail) throw new Error(fail);
      return answer;
    },
    automatic: () => automatic,
    setAutomatic: (on) => {
      automatic = on;
    },
    skipped: () => skipped,
    setSkipped: (v) => {
      skipped = v;
    },
  };
  return new UpdateService(deps);
}

beforeEach(() => {
  vi.useFakeTimers();
  answer = latest('v0.2.0');
  fail = null;
  calls = 0;
  automatic = undefined;
  skipped = null;
});
afterEach(() => vi.useRealTimers());

describe('UpdateService (spec §15.7)', () => {
  it('asks first and sends nothing until the user agrees', async () => {
    const s = service();
    s.start();
    await vi.advanceTimersByTimeAsync(2 * UPDATE_INTERVAL_MS);
    expect(s.state().ask).toBe(true);
    expect(calls).toBe(0);
    s.answer(false);
    expect(s.state().ask).toBe(false);
    await vi.advanceTimersByTimeAsync(2 * UPDATE_INTERVAL_MS);
    expect(calls).toBe(0);
  });

  it('checks at start and every 24 hours while on', async () => {
    automatic = true;
    const s = service();
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    expect(s.state().available?.version).toBe('0.2.0');
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS - 1000);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(2);
    // Off from the menu: no more checks.
    s.setAutomatic(false);
    await vi.advanceTimersByTimeAsync(3 * UPDATE_INTERVAL_MS);
    expect(calls).toBe(2);
    s.dispose();
  });

  it('remembers a skipped version; a newer one is offered; a manual check shows it anyway', async () => {
    automatic = true;
    const s = service();
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    s.skip();
    expect(skipped).toBe('0.2.0');
    expect(s.state().available).toBeNull();
    expect((await s.check()).kind).toBe('current');
    expect(s.state().available).toBeNull();
    expect((await s.check({ manual: true })).kind).toBe('newer');
    s.dismiss();
    answer = latest('v0.3.0');
    expect((await s.check()).kind).toBe('newer');
    expect(s.state().available?.version).toBe('0.3.0');
    s.dispose();
  });

  it('ignores pre-releases and drafts', async () => {
    const s = service();
    answer = latest('v0.3.0', { prerelease: true });
    expect((await s.check({ manual: true })).kind).toBe('current');
    answer = latest('v0.3.0-rc.1');
    expect((await s.check({ manual: true })).kind).toBe('current');
    answer = latest('v0.3.0', { draft: true });
    expect((await s.check({ manual: true })).kind).toBe('current');
  });

  it('a failure stays quiet; a manual check says why', async () => {
    automatic = true;
    fail = 'GitHub answered 503';
    const s = service();
    const changes = vi.fn();
    s.onChange(changes);
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.state().available).toBeNull();
    expect(await s.check({ manual: true })).toEqual({
      kind: 'failed',
      reason: 'GitHub answered 503',
    });
    s.dispose();
  });
});

describe('skippedStore', () => {
  it('keeps the skipped version in updates.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'updates-'));
    const store = skippedStore(dir);
    expect(store.get()).toBeNull();
    store.set('0.2.0');
    expect(skippedStore(dir).get()).toBe('0.2.0');
    fs.rmSync(dir, { recursive: true });
  });
});
