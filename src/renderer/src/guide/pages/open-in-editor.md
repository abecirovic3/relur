# Open in editor

{{app}} doesn't edit files itself. **Open in editor** hands a worktree, or a file at the right line, to your editor, and you come back when you're done.

## Choosing the editor

Each profile has an editor: **Edit profile › General › Editor**. It lists the editors {{app}} finds on this computer: VS Code, Cursor, IntelliJ IDEA, WebStorm and Zed. It looks for their command (`code`, `cursor`, `idea`, `webstorm`, `zed`) on your `PATH`, in JetBrains Toolbox's scripts folder, {{mac}}and for their app in Applications.{{/mac}}{{other}}and under their snap, flatpak and package names (`intellij-idea-community`, `com.visualstudio.code`, `zeditor` and the like), also in `/snap/bin`, flatpak's `exports/bin` folders and `~/.local/bin` when your shell's `PATH` lacks them.{{/other}}

A project can use another editor than its profile, so Java projects can open in IntelliJ IDEA and the frontend in VS Code: in the project view, **Setup › Editor**, choose one instead of **Use the profile's editor**.

Until an editor is set, the first **Open in editor** asks: **Choose an editor**. **Save and open** saves it for the profile and opens; tick **Only for <project>** to save it for that project alone.

The choice is kept in {{app}}'s settings, never in a repository.

## Where you'll find it

- **The workspace header:** **Open in editor** <kbd>{{key:openInEditor}}</kbd> opens the worktree. In a workspace across repositories it opens the primary one; see [Open all](#open-all).
- **A repository chip's menu:** **Open in editor** for that repository, in its project's editor.
- **The Changes panel:** **Open** on a file's row opens it at its first change; **Open in editor** above the diff, at the line you clicked in the diff. See [The Changes panel](finishing-work#the-changes-panel).
- **The project view:** **Open in editor** <kbd>{{key:openInEditor}}</kbd> opens the main checkout.
- **The spec view:** **Open in editor** opens the status file; with no editor set, in the app your system uses for it.

## Open all

In a workspace across repositories, **▾ › Open all…** next to **Open in editor** opens **Open all in editors**: every repository with the editor it will use, all ticked. Untick the ones you don't need; a repository with no editor set can't be ticked until you choose one. Repositories on VS Code or Cursor open together as one window, a multi-root workspace that {{app}} keeps in its own data folder, never in a repository. Each repository on another editor, like IntelliJ IDEA, opens its own window, so with more than three windows {{app}} asks first: **Open n editor windows?**, and **Open n windows** goes ahead.

## A custom command

Choose **Custom command…** for any other editor:

- **Open a folder** (required): the command that opens a folder, with `{path}` where the folder goes, for example `subl {path}`.
- **Open a file at a line** (optional): with `{file}` and `{line}`, for example `code -g {file}:{line}` or `idea --line {line} {file}`. Without it, a file opens as its folder.

The commands run in your shell with the profile's environment; {{app}} quotes the paths, so spaces are fine.

## When it doesn't open

If the editor's command isn't found or fails, a message at the top of the window says so, with the command it ran and where to change the editor. For example `Couldn't open Zed: its command zed wasn't found. Choose another editor in Edit profile › General › Editor.` VS Code's and Cursor's `code` and `cursor` commands come from their **Install 'code' command in PATH** action; {{app}} also starts the app directly when the command is missing.
