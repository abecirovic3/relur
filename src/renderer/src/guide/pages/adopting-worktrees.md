# Adopting worktrees

Not every worktree starts in {{app}}. A [workflow](workflows) skill may create one for its task, often in `<folder>/.worktrees/<repository>/<branch>`, the same layout as **Choose folder…** in [Where worktrees go](worktrees). You may also have made one by hand with `git worktree add`. {{app}} can take such a worktree over as a workspace.

## Other worktrees

A project's **Workspaces** tab lists, under its workspaces, the repository's other worktrees: those no workspace uses. The main checkout and the worktrees of your workspaces, including linked ones, aren't listed.

A worktree on a detached HEAD is listed without **Open as workspace**: check out a branch in it first.

## Open as workspace

**Open as workspace** asks for:

- **Task id and title:** taken from the status file when a workflow is set and the worktree has one (the task id field, and the title field or the file's first heading); otherwise from the branch name, split like the Task field of [New workspace](new-workspace). If the title was only guessed from the branch, and you didn't type your own, it's replaced once the status file gets a title field.
- **Base branch:** the project's, which you can change.
- **Run setup in it:** off, since the worktree is usually set up already. Shown only when the project has setup commands.

{{app}} copies nothing into the folder and writes nothing there. The workspace gets its block of ports, and Claude doesn't start by itself: start it in the Claude tab. The project's Start prompt isn't sent.

From then on it's a workspace like any other: Claude, shells, the Changes panel, finishing, and [Delete](delete-workspace) with its checks. Deleting removes the worktree, and its branch under the usual rules.

## The notice

When a new worktree appears in a project's worktree folder while {{app}} runs, or {{app}} finds one when its window gains focus, a notice at the top of the window says **New worktree <branch> in <project>**, with **Open as workspace**. Each one is announced once. Worktrees that existed before {{app}} started are only listed in the project's Workspaces tab, and the ones {{app}} creates itself never raise the notice.
