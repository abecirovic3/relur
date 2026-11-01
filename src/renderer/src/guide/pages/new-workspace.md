# New workspace

Click the **+** on a project row in the sidebar (it shows when you hover the row), or **New workspace** in the project view or on Home. <kbd>{{key:newWorkspace}}</kbd> uses the project you're looking at, or the project of the workspace you're in; from Home the dialog has a **Project** field to pick one, when the profile has more than one.

## The Task field

There is one **Task** field. A leading key like `ABC-123` or `#42` becomes the task id, the rest the title; a preview under the field shows the split. An id alone, or a title alone, is enough.

| You type | Task id | Title | Branch |
| --- | --- | --- | --- |
| `ENG-1423 Fix login timeout` | ENG-1423 | Fix login timeout | `ENG-1423-fix-login-timeout` |
| `#42 Dark mode` | #42 | Dark mode | `42-dark-mode` |
| `Update README` | none | Update README | `update-readme` |

The slug part of the branch is at most 50 characters, cut between words.

The **Branch name** comes from the task until you edit it, and it can't already exist, locally or on the remote. The **Base branch** is the project's; you can type or pick another.

## Looking up the title

If your profile has a **Task lookup** (Edit profile › Task lookup), type the key alone, like `ABC-123`, and press <kbd>↵</kbd>. The dialog shows **Looking up ABC-123…**, fills in the title, makes the branch from it (`ABC-123-<title>`) and creates the workspace, without another click. **Stop** ends the lookup.

If the lookup fails, because it took too long, printed nothing or ran into an error, the dialog stays open, says why (with Claude's own explanation when it gives one), and asks for the title: type it after the key and press <kbd>↵</kbd> again. Nothing is created half-way. A key with a title never looks anything up. Without a task lookup, a key alone creates the workspace without a title; if your workflow's status file has a title field, the title comes from there once the skill writes it.

The lookup asks this profile's Claude in the background, allowed only the tools you list, or runs a command you give. See [Workflows](workflows#task-lookup).

## Also in

When the profile has other projects, **Also in** lists them. Tick the ones the task changes too: each gets its own worktree on the same branch, and one Claude works in all of them. Only tick repositories you trust: Claude loads their `CLAUDE.md` and skills without asking. See [Tasks across repositories](tasks-across-repositories).

## What Create does

Clicking **Create workspace** (<kbd>{{key:confirm}}</kbd>):

1. Fetches the base branch from the remote, then adds the worktree on a new branch from it.
2. Copies the `.worktreeinclude` files, writes the task's id and title to `{{repoDir}}/task.md` in the worktree (git ignores it there), and gives the workspace its ports. See [Setup for new workspaces](workspace-setup).
3. Runs setup, if the project has any, then starts Claude, with the [Start prompt](workflows#the-start-prompt) as its first message when there is one and the task has an id. When the project has setup, the dialog shows **Run setup, then start Claude with the task brief**; untick it to skip setup and start Claude at once.

With **Also in** ticked, steps 1 and 2 happen in every repository, setup runs in each, and Claude starts once all of them have passed.
