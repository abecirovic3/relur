# Adding a project

Click **Add project** at the bottom of the sidebar <kbd>{{key:addProject}}</kbd>, then type the **Repository path** or click **Browse…** <kbd>{{key:browse}}</kbd>.

{{app}} finds the repository's main checkout (also from a folder inside it, or from one of its worktrees), its remote and its base branch: the remote's default branch, or the checked-out branch when there is no remote. You can change the name, remote and base branch before you click **Add project**. Without a remote, workspaces branch from local branches.

A repository belongs to one profile only. If it's already in another profile, {{app}} says which.

## A folder of repositories

Type or choose a folder that isn't a repository itself, for example `~/Projects`, and {{app}} lists the repositories one level down, each with a checkbox, its remote and its base branch.

- New ones start ticked. Ones already in this profile show **already added**, ones in another profile show **in <profile>**; both can't be ticked. **Select all** and **Select none** tick or untick the rest.
- Hidden folders, `node_modules`, submodules, linked worktrees and bare repositories are left out.
- The worktree location you pick applies to all of them. **Add N projects** adds each on its own and then lists what was added and what wasn't, with the reason.

## Where its worktrees go

Under **Worktrees**, choose **Default** or **Choose folder…**. See [Where worktrees go](worktrees).

## The project view

Click a project's name in the sidebar to open its view; it also opens after you add one. Its header has:

- **New workspace** <kbd>{{key:newWorkspace}}</kbd>, **Open shell** <kbd>{{key:newShell}}</kbd>, **Start Claude here** <kbd>{{key:startClaude}}</kbd> and **Open in editor** <kbd>{{key:openInEditor}}</kbd>. All but the first run in the main checkout; see [Start Claude here](start-claude-here).
- **Path**, **Base branch**, **Remote** and **Worktrees**, with **Change…** (and **Use default** once you chose a folder).
- **Remove…**; see [Removing a project](remove-project).

Below are its tabs:

| Tab | What it has |
| --- | --- |
| Workspaces | The project's workspaces: status, task, title, branch and last activity, and the workflow status when there is a workflow. Click one to open it, or Tab to the table, move with ↑ ↓ and open with ↵. Below, [Other worktrees](adopting-worktrees) |
| Setup | The project's **Editor** and its [setup and teardown commands](workspace-setup) |
| Skills | Which of the profile's [skill sources](skills#per-project) apply to this project |
| Workflow | The profile's [workflow](workflows#per-project), an override for this project, or none, and its own Start prompt |

## From a terminal

```
{{cli}} add . --profile personal
```

See [The command line tool](cli).
