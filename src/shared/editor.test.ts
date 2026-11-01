import { describe, expect, it } from 'vitest';
import { firstChangedLine } from './changes';
import { editorFor, editorInvocation, editorWindows, invocationText } from './editor';
import type { Editor } from './schemas';

const folder = { kind: 'folder' as const, path: '/w/api feat' };
const file = { kind: 'file' as const, file: "/w/api/src/it's.ts", line: 42 };
const command = (path: string) => ({ how: 'command' as const, path });

describe('editorInvocation', () => {
  it('opens a folder or a file at a line in each known editor', () => {
    expect(editorInvocation({ kind: 'vscode' }, folder, command('/bin/code'))).toEqual({
      program: '/bin/code',
      args: ['/w/api feat'],
    });
    expect(editorInvocation({ kind: 'vscode' }, file, command('/bin/code'))).toEqual({
      program: '/bin/code',
      args: ['-g', "/w/api/src/it's.ts:42"],
    });
    expect(editorInvocation({ kind: 'idea' }, file, command('/tb/idea'))).toEqual({
      program: '/tb/idea',
      args: ['--line', '42', "/w/api/src/it's.ts"],
    });
    expect(editorInvocation({ kind: 'zed' }, file, null)).toEqual({
      program: 'zed',
      args: ["/w/api/src/it's.ts:42"],
    });
  });

  it('starts an app on macOS through open -na … --args', () => {
    const app = { how: 'app' as const, path: '/Applications/Cursor.app' };
    expect(editorInvocation({ kind: 'cursor' }, file, app)).toEqual({
      program: 'open',
      args: ['-na', '/Applications/Cursor.app', '--args', '-g', "/w/api/src/it's.ts:42"],
    });
  });

  it('fills a custom command with shell-quoted values; without a file command, the folder', () => {
    const custom: Editor = {
      kind: 'custom',
      folder: 'edit -d {path}',
      file: 'edit {file} +{line}',
    };
    expect(editorInvocation(custom, folder, null)).toEqual({ shell: "edit -d '/w/api feat'" });
    expect(editorInvocation(custom, file, null)).toEqual({
      shell: "edit '/w/api/src/it'\\''s.ts' +42",
    });
    expect(editorInvocation({ kind: 'custom', folder: 'edit -d {path}' }, file, null)).toEqual({
      shell: 'edit -d /w/api/src',
    });
    expect(invocationText({ program: '/bin/code', args: ['-g', 'a b:1'] })).toBe(
      "/bin/code -g 'a b:1'",
    );
  });
});

describe('choosing the editor', () => {
  it("uses the project's own, else the profile's, else none", () => {
    expect(editorFor({ editor: { kind: 'vscode' } }, { editor: { kind: 'idea' } })).toEqual({
      editor: { kind: 'idea' },
      source: 'project',
    });
    expect(editorFor({ editor: { kind: 'vscode' } }, { editor: null })).toEqual({
      editor: { kind: 'vscode' },
      source: 'profile',
    });
    expect(editorFor({ editor: undefined }, null)).toBeNull();
  });

  it('groups VS Code and Cursor folders into one window each, every other repository its own', () => {
    const repos = [
      { id: 'a', editor: { kind: 'vscode' } as Editor },
      { id: 'b', editor: { kind: 'idea' } as Editor },
      { id: 'c', editor: { kind: 'vscode' } as Editor },
      { id: 'd', editor: { kind: 'idea' } as Editor },
      { id: 'e', editor: { kind: 'cursor' } as Editor },
    ];
    expect(editorWindows(repos).map((w) => w.map((r) => r.id))).toEqual([
      ['a', 'c'],
      ['b'],
      ['d'],
      ['e'],
    ]);
  });
});

describe('firstChangedLine', () => {
  it("finds the first line of the new version that isn't in the old one", () => {
    expect(firstChangedLine('a\nb\nc\n', 'a\nB\nc\n')).toBe(2);
    expect(firstChangedLine(null, 'new\nfile\n')).toBe(1);
    expect(firstChangedLine('a\nb\n', 'a\nb\nc\n')).toBe(3);
    expect(firstChangedLine('a\nb\nc', 'a\nb')).toBe(2);
    expect(firstChangedLine('same\n', 'same\n')).toBe(1);
  });
});
