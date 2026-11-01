# Deleting a workspace

The trash icon after the workspace's title, **Delete workspace…** in its **⋯** menu, or the sidebar's context menu removes its worktree and stops its terminals. A merged workspace and a failed setup also offer **Delete…**. The dialog says what goes and what stays, Cancel has the focus, and it warns you first when the workspace has:

- uncommitted changes, listed;
- commits that aren't pushed;
- a pull request that isn't merged yet;
- terminals still running.

With warnings the button reads **Delete anyway**, otherwise **Delete**. While there are uncommitted changes or unpushed commits, **Commit and push first** (**Commit first** without a remote) closes the dialog and opens the [Changes panel](finishing-work).

## The branch

The local branch is deleted with the workspace, unless it has unpushed commits: then it's kept unless you tick **Also delete the local branch**. The branch on the remote is never touched.

## Several repositories

A workspace across several repositories shows one card per repository, each with its warnings, or a ✓ when it's clean, and its own **Also delete the local branch**. Every worktree goes. To remove just one repository, use **Unlink <repo>…** in the **⋯** menu instead; see [Tasks across repositories](tasks-across-repositories#linking-and-unlinking).

## Teardown

If the project has teardown commands, they run before the worktree goes, in each repository. If one fails, you're told afterwards, but the workspace is still deleted. See [Setup for new workspaces](workspace-setup#setup-and-teardown-commands).

The workspace's ports are released.
