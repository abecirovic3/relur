# Removing a project

**Remove from <profile>…** in the project's context menu in the sidebar, or **Remove…** in the project view, takes the project out of {{app}}. Cancel has the focus.

- Without workspaces, only {{app}}'s entry goes. No files are deleted, and you can add the project back any time. The button reads **Remove from <profile>**.
- With workspaces, they are listed with the same checks as [Deleting a workspace](delete-workspace), each with its own **Also delete the local branch** when it has unpushed commits, and deleted with their worktrees after you confirm. The button reads **Delete and remove**, or **Delete anyway and remove** when there are warnings.
- Running terminals of the project, in its workspaces and its main checkout, are listed and stopped.
- When the project is linked into another project's workspace, only its worktree there is deleted; the workspace stays in its main project, and its Claude restarts without this one. The button then reads **Remove and delete n worktrees**. See [Tasks across repositories](tasks-across-repositories).
- The project's worktree folder is removed only if it's empty afterwards. The repository and its main checkout are never touched.
