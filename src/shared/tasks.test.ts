import { describe, expect, it } from 'vitest';
import { parseTask } from './tasks';

describe('parseTask', () => {
  it('takes a leading key as the id and the rest as the title', () => {
    expect(parseTask('PROJ-123 Fix login timeout')).toEqual({
      id: 'PROJ-123',
      title: 'Fix login timeout',
    });
    expect(parseTask('  ABC2-7: Add banner ')).toEqual({ id: 'ABC2-7', title: 'Add banner' });
    expect(parseTask('#42 - Crash on start')).toEqual({ id: '#42', title: 'Crash on start' });
    expect(parseTask('#42')).toEqual({ id: '#42', title: '' });
  });

  it('keeps anything else as the title', () => {
    expect(parseTask('fix-123 bug')).toEqual({ id: null, title: 'fix-123 bug' });
    expect(parseTask('PROJ-123abc')).toEqual({ id: null, title: 'PROJ-123abc' });
    expect(parseTask('Fix #42 later')).toEqual({ id: null, title: 'Fix #42 later' });
    expect(parseTask('A-B')).toEqual({ id: null, title: 'A-B' });
    expect(parseTask('')).toEqual({ id: null, title: '' });
  });
});
