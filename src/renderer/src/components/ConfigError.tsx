import { useMutation } from '@tanstack/react-query';
import { useTRPC } from '../trpc';

/** The bar shown while config.json can't be used, in the theme's error color. */
export function ConfigError({ error }: { error: string }) {
  const trpc = useTRPC();
  const reload = useMutation(trpc.config.reload.mutationOptions());
  const openFile = useMutation(trpc.config.openFile.mutationOptions());

  return (
    <div
      data-config-error
      className="border-b border-st-error/40 bg-st-error/8 px-4 py-3 text-sm text-fg select-text"
    >
      <div className="flex items-center gap-3">
        <strong className="font-semibold text-st-error">config.json can't be used</strong>
        <button type="button" className="underline" onClick={() => openFile.mutate()}>
          Open file
        </button>
        <button type="button" className="underline" onClick={() => reload.mutate()}>
          Reload
        </button>
      </div>
      <pre className="mt-2 font-mono text-xs whitespace-pre-wrap">{error}</pre>
    </div>
  );
}
