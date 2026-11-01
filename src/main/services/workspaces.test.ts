import { describe, expect, it } from 'vitest';
import { taskFile } from './workspaces';

describe('taskFile', () => {
  it('writes the id and url as front matter, then the title (spec §7.4)', () => {
    expect(taskFile({ id: 'PROJ-1', title: 'Fix login', url: null })).toBe(
      '---\nid: PROJ-1\n---\n# Fix login\n',
    );
    expect(taskFile({ id: null, title: 'Fix login', url: null })).toBe('# Fix login\n');
  });
});
