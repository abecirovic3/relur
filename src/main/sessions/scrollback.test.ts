import { describe, expect, it } from 'vitest';
import { Scrollback, screenAfter } from './scrollback';

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

  it('knows the kept output begins in the alternate screen once the switch is trimmed off', () => {
    const s = new Scrollback(20);
    s.push('shell\n\x1b[?1049h\x1b[Hdrawn\n');
    expect(s.startsAlternate).toBe(false);
    s.push('line one\nline two\n');
    expect(s.text()).not.toContain('1049');
    expect(s.startsAlternate).toBe(true);
    // Leaving it, also trimmed off: the kept output begins in the normal screen.
    s.push('\x1b[?1049lback\n'.padEnd(30, '.'));
    s.push('\nnormal one\nnormal two\n');
    expect(s.startsAlternate).toBe(false);
  });
});

describe('screenAfter', () => {
  it('follows 1049, 1047 and 47, set and reset, also among other modes', () => {
    expect(screenAfter('\x1b[?1049h', false)).toBe(true);
    expect(screenAfter('\x1b[?1047h', false)).toBe(true);
    expect(screenAfter('\x1b[?47h', false)).toBe(true);
    expect(screenAfter('\x1b[?1h\x1b[?47l', true)).toBe(false);
    expect(screenAfter('\x1b[?1049;1006h', false)).toBe(true);
    expect(screenAfter('\x1b[?1049hx\x1b[?1049l', false)).toBe(false);
    // Other modes and plain text leave it as it was.
    expect(screenAfter('\x1b[?25l\x1b[?2004h text 1049h', true)).toBe(true);
    expect(screenAfter('\x1b[?1006h', false)).toBe(false);
  });
});
