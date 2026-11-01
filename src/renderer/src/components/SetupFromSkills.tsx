import type { Proposal } from '@shared/proposal';
import type { Profile } from '@shared/schemas';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTRPC } from '../trpc';
import { button, inputClass, labelClass } from '../ui/controls';

/**
 * Set up from my skills (spec §13.10): pick a skill source and a workspace
 * whose worktree has a status file; the profile's Claude reads both without
 * changing anything and proposes the workflow, which fills the form.
 */
export function SetupFromSkills({
  profile,
  projectId,
  onProposal,
}: {
  profile: Profile;
  /** In a project's Workflow tab: only its workspaces. */
  projectId: string | null;
  /** The proposal, where it came from in words, and the workspace it read. */
  onProposal: (proposal: Proposal, from: string, workspaceId: string) => void;
}) {
  const trpc = useTRPC();
  const [open, setOpen] = useState(!profile.workflow);
  const candidates = useQuery(
    trpc.workflow.setupCandidates.queryOptions(
      { profileId: profile.id, projectId },
      { enabled: open, staleTime: 0 },
    ),
  );
  const choices = (candidates.data ?? []).flatMap((c) =>
    c.files.map((file) => ({ key: `${c.workspaceId}\n${file}`, ...c, file })),
  );
  const [sourceId, setSourceId] = useState(profile.skills[0]?.id ?? '');
  const [choice, setChoice] = useState('');
  const [model, setModel] = useState('');
  const chosen = choices.find((c) => c.key === choice) ?? choices[0];
  const source = profile.skills.find((s) => s.id === sourceId) ?? profile.skills[0];
  const propose = useMutation(trpc.workflow.propose.mutationOptions());
  const cancel = useMutation(trpc.workflow.cancelProposal.mutationOptions());
  const running = useRef<string | null>(null);
  const [result, setResult] = useState<{ message: string; detail?: string } | null>(null);
  const stop = () => {
    if (running.current) cancel.mutate({ requestId: running.current });
    running.current = null;
  };
  // Closing the dialog stops a proposal still running.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on unmount
  useEffect(() => () => stop(), []);
  const run = () => {
    if (!source || !chosen) return;
    const requestId = crypto.randomUUID();
    running.current = requestId;
    setResult(null);
    propose.mutate(
      {
        requestId,
        profileId: profile.id,
        sourceId: source.id,
        workspaceId: chosen.workspaceId,
        file: chosen.file,
        model: model.trim() || null,
      },
      {
        onSuccess: (answer) => {
          if (running.current !== requestId) return;
          running.current = null;
          if (answer.ok) {
            onProposal(
              answer.proposal,
              `${source.name} and ${chosen.file} in ${chosen.name}`,
              chosen.workspaceId,
            );
            setOpen(false);
          } else {
            setResult(answer.detail ? { message: answer.message, detail: answer.detail } : answer);
          }
        },
        onError: (e) => {
          running.current = null;
          setResult({ message: e.message });
        },
      },
    );
  };

  if (!open) {
    return (
      <div>
        <button
          type="button"
          data-setup-from-skills="closed"
          className={button('secondary', 'sm')}
          onClick={() => setOpen(true)}
        >
          Set up from my skills…
        </button>
      </div>
    );
  }
  const busy = propose.isPending;
  return (
    <section
      data-setup-from-skills="open"
      className="space-y-2.5 rounded-lg border border-line-strong bg-surface p-3 text-md"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium">Set up from my skills</p>
          <p className="text-sm text-fg-muted">
            This profile's Claude reads your skills and the status file of a task in progress. It
            only reads, in those two folders, and changes nothing. It fills in the form below; you
            review it and save.
          </p>
        </div>
        {profile.workflow ? (
          <button
            type="button"
            className={button('ghost', 'sm')}
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Close
          </button>
        ) : null}
      </div>
      {profile.skills.length === 0 ? (
        <p className="text-sm text-fg-subtle" data-setup-blocked="no-sources">
          Add your team's skill source in Edit profile › Skills first.
        </p>
      ) : candidates.isPending ? (
        <p className="text-sm text-fg-subtle">Looking for status files…</p>
      ) : choices.length === 0 ? (
        <p className="text-sm text-fg-subtle" data-setup-blocked="no-status-file">
          None of {projectId ? "this project's" : "this profile's"} workspaces has a status file
          yet. Start one task with your skills until it writes its status, then come back.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass} htmlFor="setup-source">
                Skill source
              </label>
              <select
                id="setup-source"
                className={inputClass}
                disabled={busy}
                value={source?.id ?? ''}
                onChange={(e) => setSourceId(e.target.value)}
              >
                {profile.skills.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="setup-model">
                Model
              </label>
              <input
                id="setup-model"
                className={`${inputClass} font-mono text-sm`}
                spellCheck={false}
                disabled={busy}
                placeholder="Profile's default"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className={labelClass} htmlFor="setup-workspace">
              A task in progress · its status file
            </label>
            <select
              id="setup-workspace"
              className={inputClass}
              disabled={busy}
              value={chosen?.key ?? ''}
              onChange={(e) => setChoice(e.target.value)}
            >
              {choices.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name} · {c.file}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-end gap-3">
            {busy ? (
              <>
                <span className="text-sm text-fg-muted" data-setup-running>
                  Claude is reading your skills… this can take a minute or two.
                </span>
                <button type="button" className={button('ghost', 'sm')} onClick={stop}>
                  Stop
                </button>
              </>
            ) : null}
            <button
              type="button"
              className={button('primary', 'sm')}
              disabled={busy || !chosen || !source}
              onClick={run}
            >
              Propose a workflow
            </button>
          </div>
          {result ? (
            <div role="alert" data-setup-error className="space-y-1 text-sm">
              <p className="text-st-error select-text">✕ {result.message}</p>
              {result.detail ? (
                <p className="text-fg-muted select-text">Claude: {result.detail}</p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
