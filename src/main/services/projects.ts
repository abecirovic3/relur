import fs from 'node:fs';
import path from 'node:path';
import { BRAND } from '@shared/brand';
import { projectSlug, WORKTREES_DIR } from '@shared/projects';
import type { Project, SetupSettings } from '@shared/schemas';
import type { AddedProject, AddRequest, AddResult, FolderAddLine } from '../bridge/server';
import type { ConfigStore } from '../config/store';
import type { EnvService } from '../env/service';
import { contractHome, expandHome } from '../paths';
import { type FolderScan, mapLimit, scanForRepositories } from '../projects/scan';

export interface ProjectCandidate {
  profileId: string;
  /** Main checkout of the picked folder. */
  repoPath: string;
  name: string;
  remotes: string[];
  remote: string | null;
  baseBranch: string;
  baseBranchSource: 'remote-head' | 'current-branch' | 'profile-default';
  /** Set when the repository is already registered (rule R1); it can't be added. */
  conflict: { projectId: string; profileId: string; profileName: string } | null;
}

export interface AddProjectInput {
  profileId: string;
  repoPath: string;
  name: string;
  remote: string | null;
  baseBranch: string;
  /** The folder its worktrees go in, under .worktrees/<project> (§8.1); null for the default. */
  worktreeRoot?: string | null;
}

const added = (project: Project, fallbackBase: string): AddedProject => ({
  id: project.id,
  profileId: project.profileId,
  repoPath: project.repoPath,
  baseBranch: project.baseBranch ?? fallbackBase,
});

function realpath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function projectId(name: string, taken: Set<string>): string {
  const base = projectSlug(name);
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** Whether `child` is `parent` or inside it. */
function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * A project's chosen worktree folder, as stored (`~/…`), after checking it
 * (spec §8.1): an existing folder, where `.worktrees/<project>` is outside the
 * repository's main checkout.
 */
export function checkWorktreeRoot(folder: string, repoPath: string, projectId: string): string {
  const absolute = path.resolve(expandHome(folder.trim()));
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
    throw new Error(`${folder} is not a folder`);
  }
  const result = path.join(realpath(absolute), WORKTREES_DIR, projectId);
  if (isInside(result, realpath(expandHome(repoPath)))) {
    throw new Error(
      "Worktrees can't go inside the repository's main checkout; choose a folder outside it",
    );
  }
  return contractHome(absolute);
}

/** What a picked or typed folder is (spec §6.1): one repository, or a folder of them. */
export type FolderExamination =
  | { kind: 'repository'; candidate: ProjectCandidate }
  | ({ kind: 'folder'; folder: string } & FolderScan);

/** One repository of a folder to add, as reviewed in the dialog. */
export interface AddManyItem {
  repoPath: string;
  name: string;
  remote: string | null;
  baseBranch: string;
}

export type AddManyResult =
  | { repoPath: string; ok: true; project: Project }
  | { repoPath: string; ok: false; error: string };

/** How many repositories are inspected at once. */
export const INSPECT_LIMIT = 4;

/** Registering repositories under a profile (spec §6.1 "Add project", rule R1). */
export class ProjectService {
  constructor(
    private readonly config: ConfigStore,
    private readonly env: EnvService,
  ) {}

  /** Inspects a folder the user picked: finds its main checkout, remote and base branch. */
  async inspect(folder: string, profileId: string): Promise<ProjectCandidate> {
    const profile = this.env.profile(profileId);
    const dir = this.existingFolder(folder);
    const git = await this.env.git(profileId);
    const repoPath = realpath(await git.mainCheckout(dir));
    const remotes = await git.remotes(repoPath);
    const remote = remotes.includes('origin') ? 'origin' : (remotes[0] ?? null);

    let baseBranch: string | null = null;
    let baseBranchSource: ProjectCandidate['baseBranchSource'] = 'profile-default';
    if (remote) {
      baseBranch = await git.remoteDefaultBranch(repoPath, remote);
      if (baseBranch) baseBranchSource = 'remote-head';
    } else {
      baseBranch = await git.currentBranch(repoPath);
      if (baseBranch) baseBranchSource = 'current-branch';
    }

    return {
      profileId,
      repoPath,
      name: path.basename(repoPath),
      remotes,
      remote,
      baseBranch: baseBranch ?? profile.defaults.baseBranch,
      baseBranchSource,
      conflict: this.findRegistered(repoPath),
    };
  }

  /**
   * A folder that is a repository (or inside one) is one project, as before;
   * otherwise the repositories one level down are offered (spec §6.1).
   */
  async examine(folder: string, profileId: string): Promise<FolderExamination> {
    const dir = this.existingFolder(folder);
    const git = await this.env.git(profileId);
    if ((await git.tryRun(dir, ['rev-parse', '--git-dir'])) !== null) {
      return { kind: 'repository', candidate: await this.inspect(dir, profileId) };
    }
    const scan = scanForRepositories(dir);
    if (scan.repositories.length === 0) {
      throw new Error(`${folder} isn't a git repository, and none of the folders in it are`);
    }
    return { kind: 'folder', folder: dir, ...scan };
  }

  /**
   * Adds several repositories with one worktree location (spec §6.1). Each is
   * checked on its own; a refusal doesn't stop the others.
   */
  async addMany(
    profileId: string,
    items: AddManyItem[],
    worktreeRoot: string | null,
  ): Promise<AddManyResult[]> {
    const results: AddManyResult[] = [];
    // One at a time: each add re-reads and writes config.json.
    for (const item of items) {
      try {
        const project = await this.add({ profileId, ...item, worktreeRoot });
        results.push({ repoPath: item.repoPath, ok: true, project });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ repoPath: item.repoPath, ok: false, error: message });
      }
    }
    return results;
  }

  /** Adds the project to config.json after re-checking the repository. */
  async add(input: AddProjectInput): Promise<Project> {
    const candidate = await this.inspect(input.repoPath, input.profileId);
    if (candidate.conflict) {
      throw new Error(
        `This repository is already registered under the ${candidate.conflict.profileName} profile`,
      );
    }
    if (input.remote !== null && !candidate.remotes.includes(input.remote)) {
      throw new Error(`The repository has no remote named "${input.remote}"`);
    }

    const name = input.name.trim() || candidate.name;
    let id = '';
    const config = this.config.update((raw) => {
      const projects = Array.isArray(raw.projects) ? raw.projects : [];
      const taken = new Set(
        projects.flatMap((p) => {
          const existing = (p as { id?: unknown }).id;
          return typeof existing === 'string' ? [existing] : [];
        }),
      );
      id = projectId(name, taken);
      // Throwing here leaves config.json as it was.
      const worktreeRoot = input.worktreeRoot
        ? checkWorktreeRoot(input.worktreeRoot, candidate.repoPath, id)
        : null;
      raw.projects = [
        ...projects,
        {
          id,
          profileId: input.profileId,
          name,
          repoPath: contractHome(candidate.repoPath),
          remote: input.remote,
          baseBranch: input.baseBranch.trim() || candidate.baseBranch,
          ...(worktreeRoot ? { worktreeRoot } : {}),
        },
      ];
    });
    const project = config.projects.find((p) => p.id === id);
    if (!project) throw new Error('The project was not saved');
    return project;
  }

  /**
   * `<slug> add` (spec §7.5). Inside a terminal of the app the profile is the
   * terminal's own and `--profile` must match it; outside, `--profile` is
   * required. The same checks as Add project apply.
   */
  async addFromCli(request: AddRequest): Promise<AddResult> {
    const { terminalProfileId, profileId: asked } = request;
    if (terminalProfileId && asked && asked !== terminalProfileId) {
      return {
        ok: false,
        error: `This terminal belongs to the ${terminalProfileId} profile; it can only add projects there`,
      };
    }
    const profileId = asked ?? terminalProfileId;
    if (!profileId) return { ok: false, error: 'Say which profile with --profile <id>' };
    if (!this.config.require().profiles.some((p) => p.id === profileId)) {
      return { ok: false, error: `There is no profile "${profileId}"` };
    }
    if (request.all) return this.addFolderFromCli(request, profileId);
    try {
      const examined = await this.examine(request.path, profileId);
      if (examined.kind === 'folder') {
        const n = examined.repositories.length;
        return {
          ok: false,
          error: `${contractHome(examined.folder)} isn't a git repository. It holds ${n} ${n === 1 ? 'repository' : 'repositories'}; add ${n === 1 ? 'it' : 'them'} with: ${BRAND.cliCommand} add ${contractHome(examined.folder)} --all`,
        };
      }
      const { candidate } = examined;
      if (candidate.conflict) {
        return {
          ok: false,
          error: `This repository is already registered under the ${candidate.conflict.profileName} profile`,
        };
      }
      const project = await this.add({
        profileId,
        repoPath: candidate.repoPath,
        name: request.name ?? candidate.name,
        remote: candidate.remote,
        baseBranch: request.base ?? candidate.baseBranch,
      });
      return { ok: true, project: added(project, candidate.baseBranch) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * `<slug> add <folder> --all` (spec §7.5): every repository one level down,
   * with the same skip rules and checks as the dialog; one line each.
   */
  private async addFolderFromCli(request: AddRequest, profileId: string): Promise<AddResult> {
    if (request.name || request.base) {
      return {
        ok: false,
        error: '--name and --base apply to one repository; leave them out with --all',
      };
    }
    try {
      const examined = await this.examine(request.path, profileId);
      const paths =
        examined.kind === 'repository' ? [examined.candidate.repoPath] : examined.repositories;
      const candidates = await mapLimit(paths, INSPECT_LIMIT, (p) =>
        this.inspect(p, profileId).catch((error: unknown) =>
          error instanceof Error ? error : new Error(String(error)),
        ),
      );
      const results: FolderAddLine[] = [];
      for (const [index, candidate] of candidates.entries()) {
        const repoPath = contractHome(paths[index] as string);
        if (candidate instanceof Error) {
          results.push({ repoPath, status: 'refused', error: candidate.message });
        } else if (candidate.conflict?.profileId === profileId) {
          results.push({ repoPath, status: 'already-added' });
        } else if (candidate.conflict) {
          results.push({
            repoPath,
            status: 'refused',
            error: `already registered under the ${candidate.conflict.profileName} profile`,
          });
        } else {
          const [result] = await this.addMany(
            profileId,
            [
              {
                repoPath: candidate.repoPath,
                name: candidate.name,
                remote: candidate.remote,
                baseBranch: candidate.baseBranch,
              },
            ],
            null,
          );
          results.push(
            result?.ok
              ? { repoPath, status: 'added', project: added(result.project, candidate.baseBranch) }
              : { repoPath, status: 'refused', error: result?.error ?? 'not added' },
          );
        }
      }
      return { ok: true, results };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Sets the project's own worktree folder, or null for the default (spec
   * §8.1). Existing workspaces keep their paths.
   */
  setWorktreeRoot(projectId: string, folder: string | null): Project {
    const current = this.config.require().projects.find((p) => p.id === projectId);
    if (!current) throw new Error(`Unknown project "${projectId}"`);
    const worktreeRoot = folder ? checkWorktreeRoot(folder, current.repoPath, current.id) : null;
    const config = this.config.update((raw) => {
      const entry = (Array.isArray(raw.projects) ? raw.projects : []).find(
        (p) => (p as { id?: unknown }).id === projectId,
      ) as Record<string, unknown> | undefined;
      if (!entry) throw new Error(`Unknown project "${projectId}"`);
      if (worktreeRoot) entry.worktreeRoot = worktreeRoot;
      else delete entry.worktreeRoot;
    });
    return config.projects.find((p) => p.id === projectId) as Project;
  }

  /**
   * The project's setup and teardown commands kept in the app (spec §8.3);
   * null removes them. Nothing is written to the repository.
   */
  setSetup(projectId: string, setup: SetupSettings | null): Project {
    const empty =
      !setup || (setup.setup.length === 0 && setup.teardown.length === 0 && !setup.ports);
    const config = this.config.update((raw) => {
      const entry = (Array.isArray(raw.projects) ? raw.projects : []).find(
        (p) => (p as { id?: unknown }).id === projectId,
      ) as Record<string, unknown> | undefined;
      if (!entry) throw new Error(`Unknown project "${projectId}"`);
      if (empty) delete entry.setup;
      else entry.setup = setup;
    });
    return config.projects.find((p) => p.id === projectId) as Project;
  }

  /** Removes the project from config.json. Nothing on disk is touched. */
  remove(projectId: string): void {
    this.config.update((raw) => {
      const projects = Array.isArray(raw.projects) ? raw.projects : [];
      const kept = projects.filter((p) => (p as { id?: unknown }).id !== projectId);
      if (kept.length === projects.length) throw new Error(`Unknown project "${projectId}"`);
      raw.projects = kept;
    });
  }

  private existingFolder(folder: string): string {
    const dir = expandHome(folder.trim());
    if (!path.isAbsolute(dir)) {
      throw new Error('Enter an absolute path, or one starting with ~/');
    }
    if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`There is no folder at ${dir}`);
    }
    return dir;
  }

  private findRegistered(repoPath: string): ProjectCandidate['conflict'] {
    const config = this.config.require();
    const project = config.projects.find((p) => realpath(expandHome(p.repoPath)) === repoPath);
    if (!project) return null;
    const profile = config.profiles.find((p) => p.id === project.profileId);
    return {
      projectId: project.id,
      profileId: project.profileId,
      profileName: profile?.name ?? project.profileId,
    };
  }
}
