import { hint, type ShortcutId } from '@shared/shortcuts';

/** Shared control styles from the design hand-off (components.md: Button, Input). */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-quiet';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-fg text-on-fg font-medium enabled:hover:opacity-[0.87]',
  secondary: 'border border-line-strong text-fg enabled:hover:bg-raised',
  ghost: 'text-fg-muted enabled:hover:bg-raised enabled:hover:text-fg',
  danger: 'bg-st-error text-on-fg font-semibold enabled:hover:opacity-[0.87]',
  'danger-quiet': 'text-st-error enabled:hover:bg-raised',
};

const SIZES: Record<Size, string> = {
  sm: 'h-6 px-2 text-sm',
  md: 'h-7 px-2.5 text-md',
  lg: 'h-7.5 px-3 text-md',
};

export function button(variant: Variant = 'secondary', size: Size = 'md'): string {
  return `inline-flex shrink-0 items-center gap-2 rounded-md whitespace-nowrap transition-colors duration-120 ease-out-quiet disabled:cursor-default disabled:opacity-40 ${SIZES[size]} ${VARIANTS[variant]}`;
}

/** Square icon-only button; give it a title with its shortcut. */
export const iconButton =
  'inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-muted transition-colors duration-120 ease-out-quiet hover:bg-raised hover:text-fg disabled:opacity-40';

export const inputClass =
  'h-7.5 w-full rounded-md border border-line-strong bg-term px-2.5 text-base text-fg outline-none placeholder:text-fg-subtle focus:border-focus focus:ring-[3px] focus:ring-focus/35 aria-invalid:border-st-error disabled:border-line disabled:bg-surface disabled:text-fg-subtle';

export const labelClass = 'mb-1 block text-sm text-fg-muted';

/** Keyboard shortcut hint shown inside a control. */
export function Kbd({ children, onFg = false }: { children: string; onFg?: boolean }) {
  return (
    <kbd
      className={`font-mono text-2xs font-normal ${onFg ? 'opacity-70' : 'text-fg-subtle'}`}
      aria-hidden
    >
      {children}
    </kbd>
  );
}

export const isMac = navigator.userAgent.includes('Mac');

/** A shortcut's keys as a hint, from the shortcut definitions (@shared/shortcuts). */
export const keyHint = (id: ShortcutId, index = 0) => hint(id, isMac, index);

/** Showing a file or folder in the file manager: Finder's name on macOS (spec §15.5). */
export const REVEAL_LABEL = isMac ? 'Reveal in Finder' : 'Show in folder';

/** ⌘ on macOS, Ctrl elsewhere, as hint text. */
export const MOD = isMac ? '⌘' : 'Ctrl+';
