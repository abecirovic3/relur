# The status line

The status line is the line of information at the bottom of Claude Code's screen, below where you type. Claude Code draws it by running a command and showing what that command prints.

## Why {{app}} uses it

When Claude runs in a workspace, {{app}} sets the status line to its own small helper. Claude Code hands that helper your plan's usage, which {{app}} shows in [Plan usage](plan-usage). Your Claude settings are not changed; this only applies to sessions {{app}} starts.

## When to set your own command

Most people never set it. Leave **Your status line command** in [Edit profile](edit-profile) › General empty, and Claude's status line shows nothing extra.

If you customized your status line in Claude Code (the `statusLine` setting in your Claude settings file), paste that command into the field. The helper then runs your command and shows its output, so your own status line still appears in {{app}}'s sessions.

:::note Why {{app}} doesn't read it for you
{{app}} never reads Claude Code's settings files, so it can't copy the command itself.
:::
