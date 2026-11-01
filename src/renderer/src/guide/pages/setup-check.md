# The setup check

Each profile has a setup check with three rows: **Claude Code installed**, **Signed in** and **Ready**. A row waits until the one above it passes. The check runs when the app starts, when you create the profile, after an install or sign-in finishes, and again when Claude can't start. To run it yourself, right-click the profile tab and choose **Check setup**, or click **Check setup** in [Edit profile](edit-profile).

## When a row needs action

| Row | What it means | What to do |
| --- | --- | --- |
| Claude Code installed | `claude` isn't on your login shell's PATH | Pick one of the official install commands, click **Install**, then **Check again**. If `claude` still isn't found afterwards, the check shows the `export PATH=…` line to add to your shell's startup file |
| Signed in | This profile's folder has no login | Click **Sign in**, finish in the browser, then **Check again** |
| Ready | Claude Code would use a different folder than the profile's | Remove `CLAUDE_CONFIG_DIR` from your shell's startup file, then **Check again** |

Install and sign-in run in a visible terminal in the check, so you see exactly what runs.

## While a check fails

Opening a project or workspace of that profile, **New workspace** or **Start Claude here** shows the setup check instead, titled **Finish setting up <profile> to open <workspace or project>** (or **to open New workspace**, **to start Claude**). When the check passes, what you asked for opens: the project or workspace, the New workspace dialog, or Claude in the view you asked from. A warning with **Set up** sits in the status bar; clicking it opens the check. The sidebar and the Home terminal still work. When you come back to the app, a check that hasn't passed runs again.

:::tip
<kbd>{{key:checkAgain}}</kbd> runs the check again.
:::
