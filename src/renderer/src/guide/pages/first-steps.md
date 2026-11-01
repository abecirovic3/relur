# First steps

1. **Create a profile.** On first launch {{app}} shows a welcome screen with **Create your first profile**. The wizard asks for a name, a color and which Claude account to use, then checks that Claude Code is ready. See [Creating a profile](create-profile).
2. **Add a project.** Choose a git repository, or a folder that holds several. <kbd>{{key:addProject}}</kbd>
3. **Create a workspace.** Type the task, for example `ENG-1423 Fix login timeout`. <kbd>{{key:newWorkspace}}</kbd>
4. **Work with Claude.** Claude starts in the new worktree, on the new branch. Type your request in its tab.

When Claude needs you, the workspace shows a status glyph and the profile tab gets a badge. See [Status glyphs](status-glyphs).

## Home

Each profile also has a Home terminal: a shell in your home folder that uses the profile's account. It's there for anything that isn't a task. <kbd>{{key:home}}</kbd>

A panel at its top right never takes the focus from the terminal. It shows one of three things:

- **Get started**, while the profile has no projects: Add project, New workspace and how Claude starts.
- **Needs you**, when workspaces wait for you, oldest first; click one to open it.
- **Quick actions** otherwise: **New workspace**, **Add project**, **Start Claude here** and your four most recent workspaces.

**Hide** or <kbd>{{key:homePanel}}</kbd> folds it into a small button in the Home bar, and back. If the Home shell exits, **Start again** starts a new one.

## Your team's skills and workflow

If your team has its own Claude Code skills and a workflow for tasks, [Set up your team's skills and workflow](team-setup) walks through setting them up.
