import type { Project, SkillSource, Workflow } from '@shared/schemas';
import type { SourceInspection, SourceShape } from '@shared/skills';
import { WORKFLOW_FILE, workflowChanges } from '@shared/workflow-file';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSubscription } from '@trpc/tanstack-react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { GuideLink, SetupGuideLink } from '../guide/link';
import { useTRPC } from '../trpc';
import { button, inputClass, labelClass } from '../ui/controls';
import { WorkflowChangeList, WorkflowSummary } from './WorkflowViews';

const SHAPE_TEXT: Record<SourceShape, string> = {
  plugin: 'Plugin',
  plugins: 'Plugins',
  skills: 'Skill folders, wrapped as a plugin',
  none: 'Nothing to load',
};

/** Refetches skill queries whenever sources or their contents change (spec §13.2). */
export function useSkillsChanges(): void {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  useSubscription(
    trpc.skills.changes.subscriptionOptions(undefined, {
      onData: () => void queryClient.invalidateQueries(trpc.skills.pathFilter()),
    }),
  );
}

const location = (source: SkillSource) =>
  source.kind === 'git' ? (source.url ?? '') : (source.path ?? '');

/** The commit line: short hash, subject and date. */
function CommitLine({ inspection }: { inspection: SourceInspection | undefined }) {
  const commit = inspection?.commit;
  if (!commit) return null;
  return (
    <p className="truncate text-sm text-fg-muted" title={commit.subject}>
      <span className="font-mono">{commit.hash}</span> {commit.subject}{' '}
      <span className="text-fg-subtle">· {new Date(commit.date).toLocaleDateString()}</span>
    </p>
  );
}

/** A source's plugins and their skills, as `/<plugin>:<skill>` with descriptions. */
export function SourceSkills({ inspection }: { inspection: SourceInspection | undefined }) {
  if (!inspection) return <p className="text-sm text-fg-subtle">Reading…</p>;
  if (inspection.error) {
    return (
      <p role="alert" className="text-sm text-st-error select-text">
        ✕ {inspection.error}
      </p>
    );
  }
  return (
    <ul className="space-y-1" data-source-skills={inspection.sourceId}>
      {inspection.plugins.flatMap((plugin) =>
        plugin.skills.length === 0
          ? [
              <li key={plugin.dir} className="text-sm text-fg-subtle">
                <span className="font-mono">{plugin.name}</span> · no skills
              </li>,
            ]
          : plugin.skills.map((skill) => (
              <li key={`${plugin.dir}/${skill.name}`} className="text-sm">
                <span className="font-mono">
                  /{plugin.name}:{skill.name}
                </span>
                {skill.error ? (
                  <span className="text-st-error"> · {skill.error}</span>
                ) : skill.description ? (
                  <span className="text-fg-muted"> · {skill.description}</span>
                ) : null}
              </li>
            )),
      )}
    </ul>
  );
}

/** "Applies to": all of the profile's projects, or the ones ticked. */
function AppliesTo({
  projects,
  value,
  onChange,
  idPrefix,
}: {
  projects: Project[];
  value: string[] | null;
  onChange: (value: string[] | null) => void;
  idPrefix: string;
}) {
  return (
    <fieldset>
      <legend className={labelClass}>Applies to</legend>
      <label className="flex items-center gap-2 text-md">
        <input
          type="radio"
          name={`${idPrefix}-applies`}
          checked={value === null}
          onChange={() => onChange(null)}
        />
        All projects of this profile
      </label>
      <label className="mt-1 flex items-center gap-2 text-md">
        <input
          type="radio"
          name={`${idPrefix}-applies`}
          checked={value !== null}
          onChange={() => onChange([])}
        />
        Selected projects
      </label>
      {value !== null ? (
        <div className="mt-1 ml-6 flex flex-col gap-1">
          {projects.length === 0 ? (
            <span className="text-sm text-fg-subtle">This profile has no projects yet.</span>
          ) : (
            projects.map((p) => (
              <label key={p.id} className="flex items-center gap-2 font-mono text-sm">
                <input
                  type="checkbox"
                  checked={value.includes(p.id)}
                  onChange={(e) =>
                    onChange(
                      e.target.checked ? [...value, p.id] : value.filter((id) => id !== p.id),
                    )
                  }
                />
                {p.name}
              </label>
            ))
          )}
        </div>
      ) : null}
    </fieldset>
  );
}

/**
 * The open workspaces whose running Claude started with other skills (spec
 * §13.3), with Restart Claude in all of them (`--resume`).
 */
export function RestartChangedClaudes({ profileId }: { profileId: string }) {
  const trpc = useTRPC();
  const changed = useQuery(trpc.skills.changedWorkspaces.queryOptions(undefined, { staleTime: 0 }));
  const all = useQuery(trpc.workspaces.list.queryOptions());
  const restart = useMutation(trpc.workspaces.restartClaude.mutationOptions());
  const ids = (changed.data ?? []).filter((id) =>
    all.data?.some((w) => w.id === id && w.profileId === profileId),
  );
  if (ids.length === 0) return null;
  return (
    <div
      data-restart-changed
      className="flex items-center gap-3 rounded-md border border-line bg-surface px-3 py-2 text-md"
    >
      <span className="min-w-0 flex-1">
        Claude runs with the old skills in {ids.length}{' '}
        {ids.length === 1 ? 'workspace' : 'workspaces'}. Restarting continues each conversation.
      </span>
      <button
        type="button"
        className={button('secondary', 'sm')}
        disabled={restart.isPending}
        onClick={() => {
          for (const workspaceId of ids) restart.mutate({ workspaceId });
        }}
      >
        Restart Claude in {ids.length}
      </button>
    </div>
  );
}

/**
 * The workflow a source carries (spec §13.9): offered with its summary after
 * the source is added or updated, else one line with Use it. Use it saves it
 * at once when the profile has no workflow; over one, it first lists what
 * would change and asks.
 */
function WorkflowOffer({
  profileId,
  read,
  current,
  offering,
  onDismiss,
}: {
  profileId: string;
  read: NonNullable<SourceInspection['workflow']>;
  current: Workflow | null;
  offering: boolean;
  onDismiss: () => void;
}) {
  const trpc = useTRPC();
  const [confirming, setConfirming] = useState(false);
  const save = useMutation(
    trpc.workflow.saveProfile.mutationOptions({
      onSuccess: () => {
        setConfirming(false);
        onDismiss();
      },
    }),
  );
  if (!read.ok) {
    return (
      <p data-workflow-offer="unusable" className="text-sm text-st-error select-text">
        ✕ Its <span className="font-mono">{WORKFLOW_FILE}</span> can't be used: {read.message}
      </p>
    );
  }
  const offered = read.workflow;
  const inUse = current !== null && workflowChanges(current, offered).length === 0;
  const use = () => {
    if (current) setConfirming(true);
    else save.mutate({ profileId, workflow: offered });
  };
  const error = save.error ? (
    <p role="alert" className="text-sm text-st-error select-text">
      ✕ {save.error.message}
    </p>
  ) : null;
  if (confirming && current) {
    return (
      <div
        data-workflow-offer="confirm"
        className="space-y-2 rounded-md border border-line-strong bg-raised p-2.5 text-md"
      >
        <p className="font-medium">Replace your current workflow?</p>
        <p className="text-sm text-fg-muted">What would change:</p>
        <WorkflowChangeList current={current} next={offered} />
        {error}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            // biome-ignore lint/a11y/noAutofocus: the safe choice
            autoFocus
            className={button('ghost', 'sm')}
            onClick={() => setConfirming(false)}
          >
            Keep mine
          </button>
          <button
            type="button"
            className={button('primary', 'sm')}
            disabled={save.isPending}
            onClick={() => save.mutate({ profileId, workflow: offered })}
          >
            Replace
          </button>
        </div>
      </div>
    );
  }
  if (offering && !inUse) {
    return (
      <div
        data-workflow-offer="offer"
        className="space-y-2 rounded-md border border-line-strong bg-raised p-2.5 text-md"
      >
        <p className="font-medium">This skill source includes a workflow. Use it?</p>
        <WorkflowSummary workflow={offered} />
        {error}
        <div className="flex justify-end gap-2">
          <button type="button" className={button('ghost', 'sm')} onClick={onDismiss}>
            Not now
          </button>
          <button
            type="button"
            className={button('primary', 'sm')}
            disabled={save.isPending}
            onClick={use}
          >
            Use it
          </button>
        </div>
      </div>
    );
  }
  return (
    <div data-workflow-offer={inUse ? 'in-use' : 'line'} className="space-y-1">
      <p className="flex items-center gap-2 text-sm text-fg-muted">
        Includes a workflow ·{' '}
        {inUse ? (
          <span>this profile uses it</span>
        ) : (
          <button
            type="button"
            className={button('ghost', 'sm')}
            disabled={save.isPending}
            onClick={use}
          >
            Use it
          </button>
        )}
      </p>
      {error}
    </div>
  );
}

/** One source in Edit profile: what it holds, Update, Edit and Remove. */
function SourceCard({
  profileId,
  source,
  inspection,
  projects,
  workflow,
  justAdded,
}: {
  profileId: string;
  source: SkillSource;
  inspection: SourceInspection | undefined;
  projects: Project[];
  /** The profile's workflow, to tell whether the source's is in use. */
  workflow: Workflow | null;
  /** Added a moment ago: its workflow is offered. */
  justAdded: boolean;
}) {
  const trpc = useTRPC();
  const [offering, setOffering] = useState(false);
  useEffect(() => {
    if (justAdded) setOffering(true);
  }, [justAdded]);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(source.name);
  const [applies, setApplies] = useState<string[] | null>(source.projects);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [deleteClone, setDeleteClone] = useState(true);
  // An update that brings new commits offers the workflow again.
  const update = useMutation(
    trpc.skills.update.mutationOptions({
      onSuccess: (result) => {
        if (result.moved) setOffering(true);
      },
    }),
  );
  const edit = useMutation(
    trpc.skills.edit.mutationOptions({ onSuccess: () => setEditing(false) }),
  );
  const remove = useMutation(trpc.skills.remove.mutationOptions());
  const error = (update.error ?? edit.error ?? remove.error)?.message;
  const scope =
    source.projects === null
      ? 'All projects'
      : source.projects.length === 0
        ? 'No projects'
        : source.projects.map((id) => projects.find((p) => p.id === id)?.name ?? id).join(', ');

  return (
    <li
      className="space-y-2 rounded-lg border border-line bg-surface p-3"
      data-skill-source={source.id}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {source.name}{' '}
            <span className="rounded-xs border border-line-strong bg-raised px-1 text-2xs text-fg-muted">
              {source.kind === 'git' ? 'git' : 'folder'}
            </span>
          </p>
          <p
            className="truncate font-mono text-sm text-fg-muted select-text"
            title={location(source)}
          >
            {location(source)}
          </p>
          <p className="text-sm text-fg-muted">
            {inspection ? SHAPE_TEXT[inspection.shape] : 'Reading…'} · {scope}
          </p>
          <CommitLine inspection={inspection} />
        </div>
        {source.kind === 'git' ? (
          <button
            type="button"
            className={button('secondary', 'sm')}
            disabled={update.isPending}
            onClick={() => update.mutate({ profileId, sourceId: source.id })}
          >
            {update.isPending ? 'Updating…' : 'Update'}
          </button>
        ) : null}
        <button
          type="button"
          className={button('ghost', 'sm')}
          onClick={() => {
            setEditing(!editing);
            setName(source.name);
            setApplies(source.projects);
          }}
        >
          Edit
        </button>
        <button
          type="button"
          className={button('danger-quiet', 'sm')}
          onClick={() => setConfirmRemove(true)}
        >
          Remove…
        </button>
      </div>
      {update.data ? (
        <p
          data-update-result
          className={`text-sm whitespace-pre-wrap select-text ${update.data.ok ? 'text-fg-muted' : 'text-st-error'}`}
        >
          {update.data.ok ? '✓' : '✕'} {update.data.message}
        </p>
      ) : null}
      <SourceSkills inspection={inspection} />
      {inspection?.workflow ? (
        <WorkflowOffer
          profileId={profileId}
          read={inspection.workflow}
          current={workflow}
          offering={offering}
          onDismiss={() => setOffering(false)}
        />
      ) : null}
      {editing ? (
        <div className="space-y-2 border-t border-line pt-2">
          <div>
            <label className={labelClass} htmlFor={`source-name-${source.id}`}>
              Name
            </label>
            <input
              id={`source-name-${source.id}`}
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <AppliesTo
            projects={projects}
            value={applies}
            onChange={setApplies}
            idPrefix={`source-${source.id}`}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className={button('ghost', 'sm')}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={button('primary', 'sm')}
              disabled={!name.trim() || edit.isPending}
              onClick={() =>
                edit.mutate({
                  profileId,
                  sourceId: source.id,
                  name: name.trim(),
                  projects: applies,
                })
              }
            >
              Save source
            </button>
          </div>
        </div>
      ) : null}
      {confirmRemove ? (
        <div className="space-y-2 border-t border-line pt-2 text-md">
          <p>
            Remove {source.name}? Claude stops getting its skills from the next start.
            {source.kind === 'folder' ? ' The folder itself stays.' : ''}
          </p>
          {source.kind === 'git' ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={deleteClone}
                onChange={(e) => setDeleteClone(e.target.checked)}
              />
              Also delete the app's clone{' '}
              <span className="font-mono text-fg-subtle">{inspection?.dir}</span>
            </label>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              // biome-ignore lint/a11y/noAutofocus: the safe choice of a removal
              autoFocus
              className={button('ghost', 'sm')}
              onClick={() => setConfirmRemove(false)}
            >
              Keep
            </button>
            <button
              type="button"
              className={button('secondary', 'sm')}
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate({
                  profileId,
                  sourceId: source.id,
                  deleteClone: source.kind === 'git' && deleteClone,
                })
              }
            >
              Remove source
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm whitespace-pre-wrap text-st-error select-text">
          ✕ {error}
        </p>
      ) : null}
    </li>
  );
}

/** Add source: a local folder or a git URL the app clones. */
function AddSource({
  profileId,
  projects,
  onAdded,
}: {
  profileId: string;
  projects: Project[];
  onAdded: (source: SkillSource) => void;
}) {
  const trpc = useTRPC();
  const [kind, setKind] = useState<'folder' | 'git'>('folder');
  const [where, setWhere] = useState('');
  const [name, setName] = useState('');
  const [applies, setApplies] = useState<string[] | null>(null);
  const pick = useMutation(trpc.skills.pickFolder.mutationOptions());
  const add = useMutation(
    trpc.skills.add.mutationOptions({
      onSuccess: (source) => {
        setWhere('');
        setName('');
        setApplies(null);
        onAdded(source);
      },
    }),
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!where.trim()) return;
    add.mutate({ profileId, name, kind, location: where.trim(), projects: applies });
  };
  return (
    <form
      onSubmit={submit}
      className="space-y-2 rounded-lg border border-dashed border-line-strong p-3"
      data-add-source
    >
      <p className="font-medium">Add a source</p>
      <div className="flex gap-4 text-md">
        <label className="flex items-center gap-2">
          <input type="radio" checked={kind === 'folder'} onChange={() => setKind('folder')} />
          Folder
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={kind === 'git'} onChange={() => setKind('git')} />
          Git URL
        </label>
      </div>
      <div className="flex gap-2">
        <input
          aria-label={kind === 'git' ? 'Git URL' : 'Folder'}
          className={`${inputClass} font-mono text-sm`}
          spellCheck={false}
          placeholder={kind === 'git' ? 'git@git.example.com:team/skills.git' : '~/code/skills'}
          value={where}
          onChange={(e) => setWhere(e.target.value)}
        />
        {kind === 'folder' ? (
          <button
            type="button"
            className={button('secondary', 'lg')}
            onClick={async () => {
              const picked = await pick.mutateAsync();
              if (picked) setWhere(picked);
            }}
          >
            Browse…
          </button>
        ) : null}
      </div>
      <input
        aria-label="Source name"
        className={inputClass}
        placeholder="Name (optional; from the folder or URL)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <AppliesTo projects={projects} value={applies} onChange={setApplies} idPrefix="new-source" />
      {add.error ? (
        <p role="alert" className="text-sm whitespace-pre-wrap text-st-error select-text">
          ✕ {add.error.message}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-3">
        {add.isPending && kind === 'git' ? (
          <span className="text-sm text-fg-muted">Cloning…</span>
        ) : null}
        <button
          type="submit"
          className={button('primary', 'sm')}
          disabled={!where.trim() || add.isPending}
        >
          Add source
        </button>
      </div>
    </form>
  );
}

/**
 * Edit profile › Skills (spec §13.2): the profile's skill sources. Changes
 * here are saved at once and reach Claude from its next start.
 */
export function SkillSourcesEditor({
  profileId,
  sources,
  projects,
  workflow,
  onGuide,
}: {
  profileId: string;
  sources: SkillSource[];
  projects: Project[];
  /** The profile's workflow (spec §13.9). */
  workflow: Workflow | null;
  /** Closes the dialog before a "?" opens the Guide. */
  onGuide: () => void;
}) {
  const trpc = useTRPC();
  const [justAdded, setJustAdded] = useState<string | null>(null);
  useSkillsChanges();
  const inspections = useQuery(trpc.skills.list.queryOptions({ profileId }, { staleTime: 0 }));
  return (
    <div className="space-y-3 text-md" data-skills-editor>
      <p className="text-fg-muted">
        <span className="float-right ml-2">
          <GuideLink to="skills#skill-sources" label="Skills" before={onGuide} />
        </span>
        Claude gets these skills in this profile's sessions, for the session only: nothing is
        written into repositories or Claude's folders. Changes are saved at once and apply when
        Claude starts next.
      </p>
      <SetupGuideLink before={onGuide} />
      <RestartChangedClaudes profileId={profileId} />
      {sources.length > 0 ? (
        <ul className="space-y-2">
          {sources.map((source) => (
            <SourceCard
              key={source.id}
              profileId={profileId}
              source={source}
              inspection={inspections.data?.find((i) => i.sourceId === source.id)}
              projects={projects}
              workflow={workflow}
              justAdded={justAdded === source.id}
            />
          ))}
        </ul>
      ) : (
        <p className="text-fg-subtle">No skill sources yet.</p>
      )}
      <AddSource
        profileId={profileId}
        projects={projects}
        onAdded={(source) => setJustAdded(source.id)}
      />
    </div>
  );
}

/**
 * Project view › Skills (spec §13.2): the profile's sources with a switch
 * each; on where they apply to this project.
 */
export function ProjectSkills({ project }: { project: Project }) {
  const trpc = useTRPC();
  useSkillsChanges();
  const listed = useQuery(trpc.skills.forProject.queryOptions({ projectId: project.id }));
  const inspections = useQuery(
    trpc.skills.list.queryOptions({ profileId: project.profileId }, { staleTime: 0 }),
  );
  const setEnabled = useMutation(trpc.skills.setEnabled.mutationOptions());
  return (
    <div className="max-w-[720px] space-y-3 py-4 text-md" data-project-skills>
      <p className="text-fg-muted">
        <span className="float-right ml-2">
          <GuideLink to="skills#per-project" label="Skills" />
        </span>
        The profile's skill sources. Claude in this project's workspaces, and a{' '}
        <span className="font-mono">claude</span> typed in its shells, get the ones switched on. Add
        or change sources in Edit profile › Skills.
      </p>
      <SetupGuideLink />
      <RestartChangedClaudes profileId={project.profileId} />
      {listed.data?.length === 0 ? (
        <p className="text-fg-subtle">This profile has no skill sources yet.</p>
      ) : null}
      <ul className="space-y-2">
        {(listed.data ?? []).map(({ source, enabled }) => {
          const inspection = inspections.data?.find((i) => i.sourceId === source.id);
          return (
            <li
              key={source.id}
              className="space-y-2 rounded-lg border border-line bg-surface p-3"
              data-project-source={source.id}
            >
              <div className="flex items-start gap-3">
                <label className="flex items-center gap-2 font-medium">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-checked={enabled}
                    checked={enabled}
                    disabled={setEnabled.isPending}
                    onChange={(e) =>
                      setEnabled.mutate({
                        projectId: project.id,
                        sourceId: source.id,
                        enabled: e.target.checked,
                      })
                    }
                  />
                  {source.name}
                </label>
                <span className="min-w-0 flex-1 truncate font-mono text-sm text-fg-muted">
                  {location(source)}
                </span>
              </div>
              <CommitLine inspection={inspection} />
              {enabled ? <SourceSkills inspection={inspection} /> : null}
            </li>
          );
        })}
      </ul>
      {setEnabled.error ? (
        <p role="alert" className="text-sm text-st-error select-text">
          ✕ {setEnabled.error.message}
        </p>
      ) : null}
    </div>
  );
}
