import { BRAND } from '@shared/brand';
import { UPDATE_QUESTION } from '@shared/updates';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSubscription } from '@trpc/tanstack-react-query';
import { useState } from 'react';
import { type AppRouterOutputs, trpcClient, useTRPC } from '../trpc';
import { button, iconButton } from '../ui/controls';
import { CommandBlock } from './SetupCheck';

type UpdateAction = AppRouterOutputs['updates']['update'];

const bar =
  'flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface px-4 py-2 text-md';

/**
 * New versions (spec §15.7), a bar under the tabs, never a dialog: the
 * first-start question, then "<app> 0.2.0 is available" with Update, Release
 * notes and Skip this version. Update opens the user's terminal with the
 * install command, or shows what to run with Copy.
 */
export function UpdateNotice() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const state = useQuery(trpc.updates.state.queryOptions());
  useSubscription(
    trpc.updates.changes.subscriptionOptions(undefined, {
      onData: () => void queryClient.invalidateQueries({ queryKey: trpc.updates.state.queryKey() }),
    }),
  );
  const [action, setAction] = useState<{ version: string; result: UpdateAction } | null>(null);
  const update = useMutation(trpc.updates.update.mutationOptions());
  const data = state.data;
  if (!data) return null;

  if (data.ask) {
    return (
      <div role="status" data-update-ask className={bar}>
        <span className="text-fg-subtle">↻</span>
        <span className="min-w-0 flex-1">{UPDATE_QUESTION}</span>
        <button
          type="button"
          className={button('secondary', 'sm')}
          onClick={() => void trpcClient.updates.answer.mutate({ check: true })}
        >
          Check for updates
        </button>
        <button
          type="button"
          className={button('ghost', 'sm')}
          onClick={() => void trpcClient.updates.answer.mutate({ check: false })}
        >
          No thanks
        </button>
      </div>
    );
  }

  const release = data.available;
  if (!release) return null;
  const shown = action?.version === release.version ? action.result : null;
  return (
    <div role="status" data-update-notice={release.version} className={bar}>
      <span className="text-fg-subtle">↑</span>
      <span className="min-w-0 flex-1">
        {BRAND.displayName} {release.version} is available
        <span className="ml-2 text-sm text-fg-subtle">you have {data.current}</span>
      </span>
      <button
        type="button"
        className={button('primary', 'sm')}
        disabled={update.isPending}
        title="Opens a terminal with the install command; it asks before it quits the app"
        onClick={() =>
          update.mutate(undefined, {
            onSuccess: (result) => setAction({ version: release.version, result }),
          })
        }
      >
        Update
      </button>
      <button
        type="button"
        data-release-notes
        className={button('ghost', 'sm')}
        onClick={() => void trpcClient.shell.openExternal.mutate({ url: release.url })}
      >
        Release notes
      </button>
      <button
        type="button"
        className={button('ghost', 'sm')}
        onClick={() => void trpcClient.updates.skip.mutate()}
      >
        Skip this version
      </button>
      <button
        type="button"
        className={iconButton}
        title="Hide until the next check"
        aria-label="Hide"
        onClick={() => void trpcClient.updates.dismiss.mutate()}
      >
        ×
      </button>
      {shown ? (
        <div data-update-action={shown.kind} className="w-full">
          {shown.kind === 'terminal' ? (
            <p className="text-sm text-fg-muted">
              A terminal opened with the install command. It asks before it quits{' '}
              {BRAND.displayName}, installs {release.version} and offers to open it again.
            </p>
          ) : (
            <>
              <p className="mb-1.5 text-sm text-fg-muted">
                {shown.why}
                {shown.link ? (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="underline hover:text-fg"
                      onClick={() =>
                        void trpcClient.shell.openExternal.mutate({ url: shown.link ?? '' })
                      }
                    >
                      Download the .deb
                    </button>
                  </>
                ) : null}
              </p>
              <CommandBlock command={shown.command} />
            </>
          )}
        </div>
      ) : null}
      {update.error ? (
        <p role="alert" className="w-full text-sm text-st-error select-text">
          ✕ {update.error.message}
        </p>
      ) : null}
    </div>
  );
}
