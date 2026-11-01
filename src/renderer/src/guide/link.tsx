import { createContext, useContext } from 'react';

/** Opens the Guide at `page#section` (components.md, Guide › Deep links). */
export const GuideContext = createContext<(href: string) => void>(() => {});

export const useOpenGuide = () => useContext(GuideContext);

/**
 * The 16px "?" that opens the Guide at a page and section. `before` runs
 * first, for a dialog that closes so the Guide can be read.
 */
export function GuideLink({
  to,
  label,
  before,
}: {
  /** `page-id` or `page-id#section`. */
  to: string;
  /** What it explains, for the tooltip. */
  label: string;
  before?: () => void;
}) {
  const open = useOpenGuide();
  return (
    <button
      type="button"
      data-guide-to={to}
      title={`${label} (Guide)`}
      aria-label={`${label} (Guide)`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        before?.();
        open(to);
      }}
      className="inline-flex size-4 flex-none items-center justify-center rounded-full border border-current text-[9.5px] font-semibold text-fg-subtle hover:text-fg"
    >
      ?
    </button>
  );
}

/** A text link to the Guide's setup walkthrough (Skills and Workflow tabs). */
export function SetupGuideLink({ before }: { before?: () => void }) {
  const open = useOpenGuide();
  return (
    <button
      type="button"
      data-guide-to="team-setup"
      onClick={(e) => {
        e.preventDefault();
        before?.();
        open('team-setup');
      }}
      className="text-sm text-fg-muted underline underline-offset-2 hover:text-fg"
    >
      Set up your team's skills and workflow, step by step
    </button>
  );
}
