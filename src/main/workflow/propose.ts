import fs from 'node:fs';
import path from 'node:path';
import {
  claudeProposalArgs,
  type ProposalResult,
  parseMcpList,
  parseProposal,
  STATUS_FIELD_NAMES,
} from '@shared/proposal';
import type { ConfigStore } from '../config/store';
import type { WorkspaceRecords } from '../db/workspaces';
import { frontMatter } from '../frontmatter';
import type { SkillService } from '../skills/service';
import { type LookupContext, runProcess } from './lookup';
import { MAX_STATUS_FILE_BYTES } from './read';

/** How long Claude may read before the proposal is stopped. */
const PROPOSAL_TIMEOUT_SEC = 300;
/** `claude mcp list` checks every server; it gets this long. */
const MCP_LIST_TIMEOUT_SEC = 45;
/** The scan for status files stops after this many entries, this deep. */
const MAX_ENTRIES = 5000;
const MAX_DEPTH = 6;
const MAX_FILES = 20;
/** Folders the scan skips besides hidden ones. */
const SKIPPED = new Set(['node_modules', 'vendor', 'dist', 'build', 'out', 'target', 'Pods']);

/**
 * Markdown files in a worktree whose front matter has a status field (spec
 * §13.10): the status files a skill may keep. Hidden and dependency folders
 * are skipped, and the scan is bounded.
 */
export function findStatusFiles(root: string): string[] {
  const found: string[] = [];
  let entries = 0;
  const walk = (dir: string, rel: string, depth: number) => {
    let names: fs.Dirent[];
    try {
      names = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    names.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of names) {
      if (found.length >= MAX_FILES || ++entries > MAX_ENTRIES) return;
      if (entry.name.startsWith('.') || SKIPPED.has(entry.name)) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH) walk(full, relPath, depth + 1);
      } else if (entry.isFile() && /\.md$/i.test(entry.name) && hasStatus(full)) {
        found.push(relPath);
      }
    }
  };
  walk(root, '', 0);
  return found;
}

function hasStatus(file: string): boolean {
  return fields(file) !== null;
}

/** A status file's front matter, when it has a status field; null otherwise. */
function fields(file: string): Record<string, unknown> | null {
  try {
    if (fs.statSync(file).size > MAX_STATUS_FILE_BYTES) return null;
    const read = frontMatter(fs.readFileSync(file, 'utf8'));
    return read && STATUS_FIELD_NAMES.some((f) => f in read) ? read : null;
  } catch {
    return null;
  }
}

/** A workspace offered for Set up from my skills: it has status files. */
export interface SetupCandidate {
  workspaceId: string;
  name: string;
  branch: string;
  files: string[];
}

/**
 * Set up from my skills (spec §13.10): finds workspaces with a status file,
 * then has the profile's Claude read the skill source and that worktree,
 * read-only, and propose the workflow. Stopped after a timeout or on Cancel.
 */
export class WorkflowSetupService {
  private readonly running = new Map<string, () => void>();

  constructor(
    private readonly config: ConfigStore,
    private readonly records: WorkspaceRecords,
    private readonly skills: SkillService,
    private readonly context: (
      profileId: string,
      projectId: string | null,
    ) => Promise<LookupContext>,
  ) {}

  /** The profile's workspaces (only the project's, given one) whose worktree has a status file. */
  candidates(profileId: string, projectId: string | null): SetupCandidate[] {
    return this.records
      .list()
      .filter((w) => w.profileId === profileId && (!projectId || w.projectId === projectId))
      .map((w) => ({
        workspaceId: w.id,
        name: w.name,
        branch: w.branch,
        files: findStatusFiles(w.worktreePath),
      }))
      .filter((c) => c.files.length > 0);
  }

  async propose(options: {
    requestId: string;
    profileId: string;
    sourceId: string;
    workspaceId: string;
    file: string;
    model: string | null;
  }): Promise<ProposalResult> {
    const failed = (message: string): ProposalResult => ({ ok: false, message });
    const workspace = this.records.get(options.workspaceId);
    if (!workspace || workspace.profileId !== options.profileId) {
      return failed('This workspace no longer exists');
    }
    const profile = this.config.get().config?.profiles.find((p) => p.id === options.profileId);
    const source = profile?.skills.find((s) => s.id === options.sourceId);
    if (!source) return failed('This skill source no longer exists');
    const file = options.file.split('/').filter(Boolean).join('/');
    const full = path.join(workspace.worktreePath, file);
    if (file.split('/').includes('..') || !full.startsWith(workspace.worktreePath + path.sep)) {
      return failed('The status file must be in the worktree');
    }
    const statusFields = fields(full);
    if (!statusFields) return failed(`${file} has no status field in its front matter`);
    const skillDir = this.skills.sourceDir(options.profileId, source);
    const inspection = await this.skills.inspect(options.profileId, source.id);
    if (inspection.error) return failed(inspection.error);
    let context: LookupContext;
    try {
      context = await this.context(options.profileId, workspace.projectId);
    } catch (error) {
      return failed(error instanceof Error ? error.message : String(error));
    }
    if (!context.claudeCommand) return failed("The profile's Claude was not found on PATH");
    const run = (args: string[], timeoutSec: number) =>
      runProcess(
        {
          command: context.claudeCommand as string,
          args,
          cwd: workspace.worktreePath,
          env: context.env,
        },
        timeoutSec,
        (cancel) => this.running.set(options.requestId, cancel),
      );

    const listed = await run(['mcp', 'list'], MCP_LIST_TIMEOUT_SEC);
    if (listed.cancelled) return this.done(options.requestId, failed('Cancelled'));
    const connectors = listed.code === 0 ? parseMcpList(listed.stdout) : [];
    const input = {
      skillDir,
      skillNames: inspection.plugins.flatMap((p) => p.skills.map((s) => `/${p.name}:${s.name}`)),
      statusFile: file,
      branch: workspace.branch,
      taskId: workspace.task.id,
      connectors,
    };
    const exited = await run(
      claudeProposalArgs(input, { model: options.model }),
      PROPOSAL_TIMEOUT_SEC,
    );
    this.running.delete(options.requestId);
    if (exited.cancelled) return failed('Cancelled');
    if (exited.timedOut) return failed(`Claude took longer than ${PROPOSAL_TIMEOUT_SEC} s`);
    if (!exited.stdout.trim()) {
      const why = exited.stderr.trim().split('\n').slice(0, 3).join(' ');
      return failed(`Claude failed (exit ${exited.code ?? '?'})${why ? `: ${why}` : ''}`);
    }
    const result = parseProposal(exited.stdout, {
      statusFile: file,
      fields: statusFields,
      branch: workspace.branch,
      taskId: workspace.task.id,
      connectors,
    });
    if (result.ok && listed.code !== 0) {
      result.proposal.undetermined.push(
        "The task lookup: the profile's connectors couldn't be listed (claude mcp list failed).",
      );
    }
    return result;
  }

  private done(requestId: string, result: ProposalResult): ProposalResult {
    this.running.delete(requestId);
    return result;
  }

  cancel(requestId: string): void {
    this.running.get(requestId)?.();
  }

  dispose(): void {
    for (const cancel of this.running.values()) cancel();
  }
}
