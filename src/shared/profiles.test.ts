import { describe, expect, it } from 'vitest';
import { colorChoices, newAccountFolder, profileIdFor } from './profiles';
import { IdSchema } from './schemas';

describe('profileIdFor', () => {
  it('slugs the name into a valid, unique id', () => {
    expect(profileIdFor('Work', [])).toBe('work');
    expect(profileIdFor('My Side Project!', [])).toBe('my-side-project');
    expect(profileIdFor('Café Ünïcode', [])).toBe('cafe-unicode');
    expect(profileIdFor('Work', ['work', 'work-2'])).toBe('work-3');
    expect(profileIdFor('???', [])).toBe('profile');
    for (const name of ['Work', '  -x- ', '日本', 'A.B']) {
      expect(IdSchema.safeParse(profileIdFor(name, [])).success).toBe(true);
    }
  });

  it('gives a new account the folder ~/.claude-<id>', () => {
    expect(newAccountFolder('side')).toBe('~/.claude-side');
  });
});

describe('colorChoices', () => {
  it('puts colors used by other profiles last, keeping palette order', () => {
    expect(colorChoices(['green', 'blue'])).toEqual({
      free: ['sky', 'teal', 'olive', 'graphite'],
      used: ['blue', 'green'],
    });
    expect(colorChoices([]).used).toEqual([]);
  });
});
