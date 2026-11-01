import { describe, expect, it } from 'vitest';
import { parseRateLimits } from './usage';

describe('parseRateLimits', () => {
  it('reads both windows with reset times in ms', () => {
    expect(
      parseRateLimits(
        {
          five_hour: { used_percentage: 34.5, resets_at: 1_800_000_000 },
          seven_day: { used_percentage: 61, resets_at: 1_800_500_000 },
        },
        42,
      ),
    ).toEqual({
      fiveHour: { usedPercentage: 34.5, resetsAt: 1_800_000_000_000 },
      sevenDay: { usedPercentage: 61, resetsAt: 1_800_500_000_000 },
      updatedAt: 42,
    });
  });

  it('keeps a window without a reset time, clamps, and is null without data', () => {
    expect(parseRateLimits({ five_hour: { used_percentage: 120 } })?.fiveHour).toEqual({
      usedPercentage: 100,
      resetsAt: null,
    });
    expect(parseRateLimits(null)).toBeNull();
    expect(parseRateLimits({ five_hour: { used_percentage: 'x' } })).toBeNull();
  });
});
