import { describe, expect, it } from 'vitest';
import { Scrollback } from './scrollback';

describe('Scrollback', () => {
  it('keeps everything under the limit', () => {
    const s = new Scrollback(100);
    s.push('a\n');
    s.push('b');
    expect(s.text()).toBe('a\nb');
  });

  it('drops the oldest output, cutting at a line break', () => {
    const s = new Scrollback(10);
    s.push('line one\n');
    s.push('line two\n');
    s.push('3\n');
    // The last 10 characters start mid-line ("ine two\n3\n"); that partial line is dropped.
    expect(s.text()).toBe('3\n');
  });

  it('keeps a partial line when there is no line break to cut at', () => {
    const s = new Scrollback(4);
    s.push('abcdefgh');
    expect(s.text()).toBe('efgh');
  });
});
