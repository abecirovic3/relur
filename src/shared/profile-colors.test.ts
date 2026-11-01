import { describe, expect, it } from 'vitest';
import { PROFILE_COLORS, toProfileColor } from './profile-colors';

describe('toProfileColor', () => {
  it('keeps palette names', () => {
    for (const name of PROFILE_COLORS) expect(toProfileColor(name)).toBe(name);
  });

  it('maps hex values to the nearest name', () => {
    expect(toProfileColor('#2F6FEB')).toBe('blue');
    expect(toProfileColor('#0EA5E9')).toBe('sky');
    expect(toProfileColor('#0D9488')).toBe('teal');
    expect(toProfileColor('#16A34A')).toBe('green');
    expect(toProfileColor('#808000')).toBe('olive');
    expect(toProfileColor('#6B7280')).toBe('graphite');
    expect(toProfileColor('#000000')).toBe('graphite');
  });

  it('falls back to graphite for anything else', () => {
    expect(toProfileColor('pink')).toBe('graphite');
    expect(toProfileColor('#abc')).toBe('graphite');
    expect(toProfileColor(undefined)).toBe('graphite');
    expect(toProfileColor(42)).toBe('graphite');
  });
});
