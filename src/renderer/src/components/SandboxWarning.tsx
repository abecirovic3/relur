import { useQuery } from '@tanstack/react-query';
import { useOpenGuide } from '../guide/link';
import { useTRPC } from '../trpc';

/**
 * The bar shown while Chromium's sandbox is off (spec §15.6), in the theme's
 * warning color, never hidden: the app never turns the sandbox off, so
 * something started it that way. Links to the Guide's Linux page.
 */
export function SandboxWarning() {
  const trpc = useTRPC();
  const off = useQuery(trpc.app.sandboxOff.queryOptions());
  const openGuide = useOpenGuide();
  if (!off.data) return null;
  return (
    <div
      data-sandbox-warning
      className="flex items-center gap-3 border-b border-st-permission/40 bg-st-permission/8 px-4 py-2 text-sm text-fg select-text"
    >
      <span className="inline-block h-[9px] w-[10px] shrink-0 bg-st-permission [clip-path:polygon(50%_0,100%_100%,0_100%)]" />
      <strong className="font-semibold">Running without Chromium's sandbox</strong>
      <span className="text-fg-muted">{off.data}</span>
      <button
        type="button"
        data-guide-to="linux#the-sandbox"
        className="underline underline-offset-2"
        onClick={() => openGuide('linux#the-sandbox')}
      >
        How to turn it on
      </button>
    </div>
  );
}
