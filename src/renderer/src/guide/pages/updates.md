# Updates and privacy

{{app}} runs on your machine. It has no telemetry, analytics or accounts, and stores no credentials. Your code reaches Anthropic the way it always does with Claude Code, and your git host when you push.

## Checking for new versions

The one request {{app}} makes on its own is the check for new versions, and only if you allow it. On its first start a bar asks: **Check for updates** or **No thanks**. If you agree, {{app}} asks GitHub for its latest release when it starts and once a day while it runs. The request carries {{app}}'s name and version and nothing else: no cookies, no identifiers, nothing about you or your work.

You can change your mind in the {{mac}}{{app}} menu{{/mac}}{{other}}Help menu{{/other}}: **Check for Updates Automatically** turns the daily check on or off, and **Check for Updates…** asks right away, whatever the setting, and says if something went wrong. Pre-releases are never offered.

## Updating

When a newer version is out, a bar says so: **{{app}} 0.2.0 is available**.

- **Update** opens your terminal with the install command. It asks before it quits {{app}}, installs the new version and offers to open it again. {{app}} never downloads or replaces itself, and never asks for your password.
- **Release notes** opens the release page in your browser.
- **Skip this version** stops the bar for that version; the next one shows again.

If no terminal can be opened, the bar shows the command with **Copy**, to run yourself.{{other}} If you installed the `.deb`, the bar shows a link to the new `.deb` and the `apt` command that installs it, with **Copy**; `apt` asks for your password in your terminal.{{/other}}
