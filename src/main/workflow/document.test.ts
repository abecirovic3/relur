import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkflowSchema } from '@shared/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { documentImages, readDocument } from './document';

let root: string;
let tree: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'document-'));
  tree = path.join(root, 'tree');
  fs.mkdirSync(path.join(tree, 'docs', 'specs', 'a', 'img'), { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const file = 'docs/specs/a/specification.md';
const workflow = WorkflowSchema.parse({ file: 'docs/specs/*/specification.md' });

describe('readDocument', () => {
  it('splits off the front matter and labels the tab', () => {
    fs.writeFileSync(
      path.join(tree, file),
      '---\nstatus: spec-review\nticket: https://tracker.example.com/A-1\nnotes: [a, b]\n---\n# Login\n',
    );
    expect(readDocument(tree, file, workflow)).toEqual({
      file,
      label: 'specification.md',
      markdown: '# Login\n',
      fields: { status: 'spec-review', ticket: 'https://tracker.example.com/A-1' },
    });
    expect(readDocument(tree, file, { ...workflow, documentLabel: 'Spec' }).label).toBe('Spec');
  });
});

describe('documentImages', () => {
  it('gives data: URLs for images inside the worktree only', () => {
    fs.writeFileSync(path.join(tree, 'docs', 'specs', 'a', 'img', 'flow.png'), 'png');
    fs.writeFileSync(path.join(tree, 'logo.svg'), '<svg/>');
    fs.writeFileSync(path.join(root, 'outside.png'), 'secret');
    fs.writeFileSync(path.join(tree, 'notes.txt'), 'text');
    fs.symlinkSync(path.join(root, 'outside.png'), path.join(tree, 'link.png'));
    const images = documentImages(tree, file, [
      'img/flow.png',
      'img/flow%2Epng?x=1',
      '../../../logo.svg',
      '../../../../outside.png',
      '../../../link.png',
      '../../../notes.txt',
      'https://example.com/a.png',
      '/etc/a.png',
      'img/missing.png',
    ]);
    expect(images['img/flow.png']).toBe(
      `data:image/png;base64,${Buffer.from('png').toString('base64')}`,
    );
    expect(images['img/flow%2Epng?x=1']).toBe(images['img/flow.png']);
    expect(images['../../../logo.svg']).toMatch(/^data:image\/svg\+xml;base64,/);
    for (const blocked of [
      '../../../../outside.png',
      '../../../link.png',
      '../../../notes.txt',
      'https://example.com/a.png',
      '/etc/a.png',
      'img/missing.png',
    ]) {
      expect(images[blocked], blocked).toBeNull();
    }
  });
});
