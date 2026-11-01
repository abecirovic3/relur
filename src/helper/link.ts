import type { LinkResponse, ProjectsResponse } from '../main/bridge/server';
import { BRAND, envVar } from '../shared/brand';
import { callApp, type Output, stdio } from './bridge';

const LINK_USAGE = `usage: ${BRAND.cliCommand} link <project name, id or repository path>`;
const PROJECTS_USAGE = `usage: ${BRAND.cliCommand} projects [--profile <id>]`;
/** Link answers once the setup has run; setups may take long (15 minutes by default). */
const LINK_TIMEOUT_MS = 6 * 60 * 60 * 1000;

/**
 * `<slug> link <project>` (spec §21.9): links another repository of the
 * profile to the workspace this runs in, as Link another repository… does,
 * and prints the new worktree path once its setup has run. Exit codes: 0
 * linked, 1 refused or its setup failed (still linked), 2 the app isn't running.
 */
export async function runLink(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  io: Output = stdio,
): Promise<number> {
  if (args[0] === '--help' || args[0] === '-h') {
    io.out(`${LINK_USAGE}\n`);
    return 0;
  }
  const project = args[0];
  if (args.length !== 1 || !project || project.startsWith('-')) {
    io.err(`${LINK_USAGE}\n`);
    return 1;
  }
  const result = await callApp<LinkResponse>(
    env,
    '/link',
    {
      project,
      cwd,
      workspaceId: env[envVar('WORKSPACE_ID')] ?? null,
      profileId: env[envVar('PROFILE')] ?? null,
      byClaude: Boolean(env.CLAUDECODE),
    },
    LINK_TIMEOUT_MS,
    io,
  );
  if (result === 2) return 2;
  if (!result.ok) {
    io.err(`${result.error}\n`);
    return 1;
  }
  if (result.added) io.out(`Added ${result.name} as a project of this profile.\n`);
  io.out(`Linked ${result.name}: ${result.worktreePath}\n`);
  io.out(
    `Branch ${result.branch}, from ${result.baseBranch}. Make its changes in that folder, not in its main checkout; read its CLAUDE.md there if it has one.\n`,
  );
  if (result.setupError) {
    io.err(
      `Its setup failed (${result.setupError}): see the Setup · ${result.name} tab in the app. Fix the cause, or ask the user to retry the setup, before working there.\n`,
    );
    return 1;
  }
  if (result.setup) io.out(`Its setup passed (the Setup · ${result.name} tab in the app).\n`);
  return 0;
}

const PLACE = { main: 'main repository of this workspace', linked: 'linked', no: '' } as const;

/** `<slug> projects` (spec §21.9): the profile's projects and their part in this workspace. */
export async function runProjects(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  io: Output = stdio,
): Promise<number> {
  let profile: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--profile' && args[i + 1]) profile = args[++i] as string;
    else if (args[i] === '--help' || args[i] === '-h') {
      io.out(`${PROJECTS_USAGE}\n`);
      return 0;
    } else {
      io.err(`${PROJECTS_USAGE}\n`);
      return 1;
    }
  }
  const own = env[envVar('PROFILE')] || null;
  if (profile && own && profile !== own) {
    io.err(`This terminal belongs to the ${own} profile\n`);
    return 1;
  }
  const result = await callApp<ProjectsResponse>(
    env,
    '/projects',
    { workspaceId: env[envVar('WORKSPACE_ID')] ?? null, profileId: profile ?? own },
    10_000,
    io,
  );
  if (result === 2) return 2;
  if (!result.ok) {
    io.err(`${result.error}\n`);
    return 1;
  }
  const width = Math.max(0, ...result.projects.map((p) => p.name.length));
  for (const p of result.projects) {
    const place = p.inWorkspace ? PLACE[p.inWorkspace] : '';
    io.out(`${p.name.padEnd(width)}  ${p.repoPath}${place ? `  (${place})` : ''}\n`);
  }
  if (result.projects.length === 0) io.out('No projects in this profile yet\n');
  return 0;
}
