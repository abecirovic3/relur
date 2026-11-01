# Plan usage

The status bar shows how much of your plan's limits the current profile has used. It appears once the profile's setup check has passed.

## Session and Week

**Session** is the current five-hour window, with the time until it resets. **Week** is the seven-day limit. Each shows the share used as a small bar and a percentage, which turn amber at 80%. Hover a meter to see when it resets, or the meters to see when they were last updated.

The numbers come from Claude Code's status line while Claude runs in one of the profile's workspaces. See [The status line](status-line).

## Stale and n/a

- **Stale**: no update for ten minutes, because no Claude of this profile has answered since. The last numbers stay, striped, with how long ago they came.
- **Usage n/a**: nothing has arrived yet, for example before Claude has answered once in this profile. A profile that signs in to Claude with an API key instead of a plan never gets these numbers.
