# The terminal shortcut

For a profile with its own account folder, the last step of the New profile wizard offers a **Terminal shortcut (optional)**: an alias, so you can run Claude Code with that account in any terminal. It's named after the profile:

```zsh
alias claude-personal='CLAUDE_CONFIG_DIR=~/.claude-personal claude'
```

Copy it, or click **Add to ~/.zshrc…** (for bash, `~/.bashrc`; for fish, its `config.fish`). {{app}} asks first, showing the file and the line, and **Add line** appends that one line to the end of the file and changes nothing else. If the line is already there, nothing is written.

The wizard offers it only once. To add it later, copy the line above with your profile's name and folder into your shell's startup file yourself.

## Using it

The alias works in terminals opened afterwards. In a terminal that is already open, run:

```zsh
source ~/.zshrc
```

Terminals inside {{app}} don't need it: they already use the profile's account.
