import type { ProfileColor } from '@shared/profile-colors';

/** Static class names per palette color, so Tailwind sees them all. */
export const PROFILE_DOT: Record<ProfileColor, string> = {
  blue: 'bg-profile-blue',
  sky: 'bg-profile-sky',
  teal: 'bg-profile-teal',
  green: 'bg-profile-green',
  olive: 'bg-profile-olive',
  graphite: 'bg-profile-graphite',
};

/** 2px top edge of the active profile tab, inset. */
export const PROFILE_TOP_EDGE: Record<ProfileColor, string> = {
  blue: 'shadow-[inset_0_2px_0_var(--color-profile-blue)]',
  sky: 'shadow-[inset_0_2px_0_var(--color-profile-sky)]',
  teal: 'shadow-[inset_0_2px_0_var(--color-profile-teal)]',
  green: 'shadow-[inset_0_2px_0_var(--color-profile-green)]',
  olive: 'shadow-[inset_0_2px_0_var(--color-profile-olive)]',
  graphite: 'shadow-[inset_0_2px_0_var(--color-profile-graphite)]',
};

export function ProfileDot({ color, size = 8 }: { color: ProfileColor; size?: 6 | 8 }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 rounded-full ${size === 8 ? 'size-2' : 'size-1.5'} ${PROFILE_DOT[color]}`}
    />
  );
}
