import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveExecutable } from './which';

let dir: string;
let binA: string;
let binB: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'which-'));
  binA = path.join(dir, 'a');
  binB = path.join(dir, 'b');
  fs.mkdirSync(binA);
  fs.mkdirSync(binB);
  fs.writeFileSync(path.join(binA, 'tool'), '', { mode: 0o644 }); // not executable
  fs.writeFileSync(path.join(binB, 'tool'), '#!/bin/sh\n', { mode: 0o755 });
  fs.mkdirSync(path.join(binA, 'dironly'));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('resolveExecutable', () => {
  it('searches the given PATH, skipping non-executables and directories', () => {
    const env = { PATH: [binA, binB].join(path.delimiter) };
    expect(resolveExecutable('tool', env)).toBe(path.join(binB, 'tool'));
    expect(resolveExecutable('dironly', env)).toBeNull();
    expect(resolveExecutable('missing', env)).toBeNull();
  });

  it('uses commands with a path as given, expanding ~', () => {
    expect(resolveExecutable(path.join(binB, 'tool'), {})).toBe(path.join(binB, 'tool'));
    expect(resolveExecutable('~/b/tool', {}, dir)).toBe(path.join(binB, 'tool'));
    expect(resolveExecutable('~/a/tool', {}, dir)).toBeNull();
  });
});
