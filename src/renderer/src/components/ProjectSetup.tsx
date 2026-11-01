import { BRAND } from '@shared/brand';
import type { Project } from '@shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { GuideLink } from '../guide/link';
import { useTRPC } from '../trpc';
import { button, inputClass, labelClass } from '../ui/controls';

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/**
 * Project view › Setup (spec §8.3): the commands that set up and tear down
 * its workspaces. They are kept in the app's own settings, so nothing is
 * added to the repository; a repository with its own `.<slug>/config.json`
 * uses that file instead, shown here read-only.
 */
export function ProjectSetup({ project }: { project: Project }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const plan = useQuery(
    trpc.projects.setup.queryOptions({ projectId: project.id }, { staleTime: 0 }),
  );
  const own = project.setup;
  const [setup, setSetup] = useState(own?.setup.join('\n') ?? '');
  const [teardown, setTeardown] = useState(own?.teardown.join('\n') ?? '');
  const [ports, setPorts] = useState(own?.ports ? String(own.ports) : '');
  const [startClaude, setStartClaude] = useState(own?.startClaude ?? 'after-setup');
  const [saved, setSaved] = useState(false);
  const save = useMutation(
    trpc.projects.setSetup.mutationOptions({
      onSuccess: () => {
        setSaved(true);
        void queryClient.invalidateQueries({ queryKey: trpc.projects.setup.queryKey() });
      },
    }),
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    const count = Number(ports);
    save.mutate({
      projectId: project.id,
      setup: {
        setup: lines(setup),
        teardown: lines(teardown),
        ports: ports.trim() && Number.isInteger(count) ? count : undefined,
        startClaude,
      },
    });
  };

  if (plan.data?.source === 'repo') {
    const current = `${BRAND.repoDirName}/config.json`;
    const file = plan.data.file ?? current;
    return (
      <div className="max-w-[640px] space-y-3 py-4 text-md" data-project-setup="repo">
        <p className="text-fg-muted">
          From <span className="font-mono text-fg">{file}</span> in the repository. Edit it there;
          the commands here aren't used while it exists.
        </p>
        {file !== current ? (
          <p data-legacy-repo-config className="text-sm text-fg-muted">
            <span className="text-st-permission">▲</span> That's {BRAND.legacy.displayName}'s name
            for it. Rename the folder to{' '}
            <span className="font-mono text-fg">{BRAND.repoDirName}</span> and commit it; until then{' '}
            {BRAND.displayName} still reads the old one.
          </p>
        ) : null}
        {plan.data.error ? (
          <p role="alert" className="text-sm text-st-error select-text">
            ✕ {plan.data.error}
          </p>
        ) : (
          <dl className="space-y-2 rounded-lg border border-line bg-surface p-3 text-sm">
            {(
              [
                ['Setup', plan.data.setup.join('\n') || 'none'],
                ['Teardown', plan.data.teardown.join('\n') || 'none'],
                ['Ports', String(plan.data.ports)],
                [
                  'Claude',
                  plan.data.startClaude === 'parallel' ? 'starts with setup' : 'starts after setup',
                ],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="grid grid-cols-[96px_1fr] gap-3">
                <dt className="text-fg-muted">{label}</dt>
                <dd className="font-mono whitespace-pre-wrap select-text">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    );
  }

  const textarea = `${inputClass} h-auto min-h-16 py-1.5 font-mono text-sm`;
  return (
    <form
      onSubmit={submit}
      className="max-w-[640px] space-y-3 py-4 text-md"
      data-project-setup="app"
    >
      <p className="text-fg-muted">
        <span className="float-right ml-2">
          <GuideLink
            to="workspace-setup#setup-and-teardown-commands"
            label="Setup for new workspaces"
          />
        </span>
        Runs in each new workspace's worktree, in its Setup tab, with the workspace environment.
        Kept in {BRAND.displayName}'s settings, so nothing is added to the repository. A{' '}
        <span className="font-mono">{BRAND.repoDirName}/config.json</span> in the repository
        replaces these.
      </p>
      <div>
        <label htmlFor="setup-commands" className={labelClass}>
          Setup commands · one per line, run in order
        </label>
        <textarea
          id="setup-commands"
          className={textarea}
          spellCheck={false}
          placeholder="npm ci"
          value={setup}
          onChange={(e) => setSetup(e.target.value)}
        />
        <p data-setup-hint className="mt-1 text-sm text-fg-subtle">
          Each line runs on its own, so a <span className="font-mono">cd</span> or{' '}
          <span className="font-mono">export</span> doesn't carry over to the next line. Put steps
          that belong together on one line: <span className="font-mono">cd app && npm install</span>
          .
        </p>
      </div>
      <div>
        <label htmlFor="teardown-commands" className={labelClass}>
          Teardown commands · run when a workspace is deleted
        </label>
        <textarea
          id="teardown-commands"
          className={textarea}
          spellCheck={false}
          placeholder="docker compose down"
          value={teardown}
          onChange={(e) => setTeardown(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="setup-ports" className={labelClass}>
            Ports per workspace
          </label>
          <input
            id="setup-ports"
            className={`${inputClass} font-mono text-sm`}
            inputMode="numeric"
            placeholder="10"
            value={ports}
            onChange={(e) => setPorts(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="setup-claude" className={labelClass}>
            Claude starts
          </label>
          <select
            id="setup-claude"
            className={inputClass}
            value={startClaude}
            onChange={(e) => setStartClaude(e.target.value as typeof startClaude)}
          >
            <option value="after-setup">after setup succeeds</option>
            <option value="parallel">together with setup</option>
          </select>
        </div>
      </div>
      {save.error ? (
        <p role="alert" className="text-sm text-st-error select-text">
          ✕ {save.error.message}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <button type="submit" className={button('primary')} disabled={save.isPending}>
          Save
        </button>
        {saved ? (
          <span className="text-sm text-fg-muted">Saved · used by new workspaces</span>
        ) : null}
      </div>
    </form>
  );
}
