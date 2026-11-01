import { BRAND } from '@shared/brand';
import appIcon from '../../../../build/icon.svg';
import { button, Kbd } from '../ui/controls';

/** Shown next to every account action: the app never handles the Claude login (spec D12). */
export const LOGIN_PROMISE = `${BRAND.displayName} never handles your Claude login. It runs Claude Code's own commands in a terminal you can see, and sign-in finishes in your browser.`;

/** The main area while there are no profiles (spec §6.11, first launch). */
export function FirstLaunch({ onCreateProfile }: { onCreateProfile: (() => void) | null }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-canvas p-6">
      <div className="flex w-[440px] max-w-full flex-col items-start gap-5">
        <img src={appIcon} alt="" aria-hidden className="-m-2 size-24" />
        <div className="flex flex-col gap-2">
          <h1 className="text-[22px] leading-7 font-semibold tracking-[-0.01em]">
            Welcome to {BRAND.displayName}
          </h1>
          <p className="text-[13.5px] leading-normal text-pretty text-fg-muted">
            Run Claude Code sessions side by side, one worktree per task. A profile pairs one Claude
            account with its projects, so work and personal stay apart.
          </p>
        </div>
        <button
          type="button"
          // biome-ignore lint/a11y/noAutofocus: the one action on the screen
          autoFocus
          className={button('primary', 'lg')}
          disabled={!onCreateProfile}
          onClick={onCreateProfile ?? undefined}
        >
          Create your first profile <Kbd onFg>↵</Kbd>
        </button>
        <p className="text-sm leading-normal text-pretty text-fg-subtle">{LOGIN_PROMISE}</p>
      </div>
    </div>
  );
}
