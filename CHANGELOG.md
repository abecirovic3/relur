# Changelog

All notable changes to Relur. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). A release's section here is its GitHub release notes.

## [Unreleased]

## [0.2.0] - 2026-11-02

### Added

- New versions: on the first start Relur asks whether to check GitHub for its latest release once a day; nothing about you or your work is sent. A newer version shows a quiet notice with **Update** (opens your terminal with the install command), **Release notes** and **Skip this version**. **Check for Updates…** and **Check for Updates Automatically** are in the app menu (the Help menu on Linux).
- Continue interrupted work: when Relur stops while Claude is working (quit, logout, an update, a crash), the workspace is marked **Unfinished**. A profile setting continues that work at the next start, one workspace after another and never at the plan limit; otherwise Relur asks once at start which workspaces to continue.
- A workspace that was done but still had background commands running (a dev server, a long test run) is marked **Unfinished** too, with "1 background command was stopped". It's never continued by itself: you choose it in the overview or with **Continue**.
- Changes panel: a draggable divider between the file list and the diff; the list is as tall as its files up to about five rows; clicking its header collapses it to one line with previous and next file (⌥⌘↑ / ⌥⌘↓); in Full view the list is a resizable column.

### Changed

- The quit dialog says what happens to Claude's unfinished work at the next start.
- The Guide: First steps goes on to finishing a task, the Resume page is now **Quitting and resuming**, and the pages cover the Unfinished marker, background commands, the update notice and the Linux menu.

### Fixed

- Quitting while typing in a terminal could show "The database connection is not open" in an error dialog. Once a quit goes ahead, Relur takes no more terminal input or hook events, and closes its database last.

## [0.1.0] - 2026-11-02

### Added

- Parallel Claude Code sessions, each in its own git worktree and branch, created from a task with setup commands and a block of ports.
- Status for every session from Claude Code's hooks: working, needs permission, waiting for input, awaiting approval, done; in the sidebar, the Dock badge, notifications and optional sounds.
- Profiles that keep Claude accounts, settings and projects apart, with a setup check that installs and signs in with Claude Code's own commands.
- The Changes panel with a read-only diff, Commit, Push and Create PR, and the PR badge. The panel is resizable, has a Full view (⇧⌘M) and a Unified / Side by side switch; the view buttons are in the tab bar.
- Skills and workflows from a status file, with gates and Continue; linked repositories in one workspace.
- Plan usage in the status bar, from Claude Code's status line.
- The `relur` command line tool (`add`, `link`, `projects`), the in-app Guide, and Open in editor.
- macOS (Apple Silicon and Intel) and Linux beta builds (AppImage and `.deb`), with an install script. Both Linux builds keep Chromium's sandbox, the AppImage on Ubuntu 23.10 and later once it's listed for it, and the window says so when it runs without it.

[Unreleased]: https://github.com/dino-zecevic/relur/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/dino-zecevic/relur/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/dino-zecevic/relur/releases/tag/v0.1.0
