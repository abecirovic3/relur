# Where worktrees go

Each workspace is a git worktree: a second folder of the same repository, on its own branch. {{app}} keeps worktrees outside the repository, so editors and file watchers in your main checkout don't pick them up.

## Default

`~/{{homeDir}}/worktrees/<profile>/<project>/<branch>`. Choosing **Default** stores nothing, so the project follows the profile.

## A folder you choose

**Choose folder…** in Add project, or **Change…** under **Worktrees** in the project view, picks a parent folder. {{app}} makes a hidden `.worktrees` folder in it, with one folder per project inside:

```
# You chose ~/Projects for the project api-service:
~/Projects/.worktrees/api-service/ENG-1423-fix-login-timeout
```

So you can choose the folder your repositories are in: the worktrees go next to them, in `.worktrees`, not into the repository. A folder that would put them inside the repository's main checkout is refused.

## Good to know

- The project view's **Worktrees** line shows the folder in use. **Use default** there goes back to the default.
- Worktrees made there by a skill or by hand can become workspaces; see [Adopting worktrees](adopting-worktrees).
- A change applies to new workspaces; existing ones keep their folders.
- Removing a project removes its emptied worktree folder and an emptied `.worktrees`, never the folder you chose.
