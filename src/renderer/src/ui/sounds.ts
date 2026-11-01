import type { WorkspaceState } from '@shared/status';

/**
 * Alert sounds (spec §10.3), generated with the Web Audio API so there are
 * no sound files: two rising notes when Claude needs you, one soft note when
 * it is done, two falling low notes for an error.
 */
let context: AudioContext | null = null;

function tone(ctx: AudioContext, frequency: number, start: number, length: number, volume: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = frequency;
  // A short attack and an exponential fade, so it never clicks.
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

export function playAlert(state: WorkspaceState): void {
  try {
    context ??= new AudioContext();
    const now = context.currentTime + 0.01;
    if (state === 'done') {
      tone(context, 659.25, now, 0.35, 0.08);
    } else if (state === 'error') {
      tone(context, 440, now, 0.18, 0.12);
      tone(context, 329.63, now + 0.15, 0.3, 0.12);
    } else {
      tone(context, 880, now, 0.16, 0.12);
      tone(context, 1174.66, now + 0.13, 0.22, 0.12);
    }
  } catch {
    // no audio output
  }
}
