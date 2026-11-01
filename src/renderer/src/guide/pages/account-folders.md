# Account folders

Each profile uses its own Claude account folder: `~/.claude` for your default login, or for example `~/.claude-personal` for a second one. The folder holds the login, settings and history of that account.

{{app}} starts Claude Code and every terminal of the profile with `CLAUDE_CONFIG_DIR` set to the profile's folder, so Work and Personal never mix. The default folder needs no variable at all.

Two profiles can use the same folder, but then they share one login, settings, history and plan usage, and signing out in one signs out both. The New profile wizard warns you when you pick a folder another profile uses.

## What {{app}} reads

To show which folders exist, {{app}} only checks whether a folder has been used by Claude Code (whether it has a `.claude.json`). For a used folder it runs `claude auth status` with that folder, to show whether it's signed in and as whom; an unused folder shows **Not used yet**, and nothing is run there. {{app}} never opens your login, credentials, the Keychain or Claude Code's settings files.

:::note Privacy
{{app}} never handles your Claude login. It runs Claude Code's own commands, such as `claude auth login`, in a terminal you can see; sign-in finishes in your browser, and {{app}} stores no tokens or passwords.
:::
