# {{app}} on Linux

{{app}} runs on 64-bit Linux, Intel/AMD (x64) and ARM (arm64), with any desktop: GNOME, KDE Plasma, Cinnamon, Xfce and others, on Wayland or X11. It needs glibc 2.31 or later: Ubuntu 22.04, Debian 12, Fedora 36 and later, and the distributions built on them. Distributions with musl, such as Alpine, aren't supported.

## Installing

The install script puts the AppImage in `~/Applications`, adds {{app}} to your desktop's app list with its icon (in `~/.local/share`), and the `{{cli}}` command to `~/.local/bin`; it never asks for sudo:

```
curl -fsSL https://raw.githubusercontent.com/{{repo}}/main/install.sh | sh
```

Running it again updates {{app}}; `sh install.sh --uninstall` removes it and keeps your settings in `{{configDir}}`. There are no automatic updates.

On Debian and Ubuntu you can install the `.deb` from the release instead (`sudo apt install ./{{app}}-linux-x64.deb`). It installs to `/opt/{{app}}`, needs no FUSE, and sets up the sandbox on Ubuntu 24.04 by itself. Updates are the same: install the newer `.deb`. **Install Command Line Tool…** in the **File** menu adds the `{{cli}}` command. Use one of the two, not both.

## What's different from macOS

- **Keys:** Ctrl takes the place of the Command key, except where the shell needs Ctrl with that letter: those shortcuts are Ctrl+Shift (Ctrl+Shift+L, Ctrl+Shift+W and so on), and **Check again** is F5. In terminals, Ctrl+Shift+C and Ctrl+Shift+V copy and paste. See [Keyboard shortcuts](shortcuts).
- **The menu** is in the window: **File**, **Edit**, **View**, **Window** and **Help**. **Install Command Line Tool…** is in **File**, and **About** in **Help**.
- **Closing the window quits {{app}}**, asking first while something runs. See [Quitting](resume#quitting).
- **Badges:** the window title starts with how many workspaces need you, and docks that show badges show it on the icon too. See [Badges](notifications#badges).
- **Show in folder** opens the folder in your file manager, and links and files open in your default apps (through `xdg-open`).

## The AppImage doesn't start

**It mentions FUSE or fusermount.** The AppImage mounts itself with FUSE, which needs the `fusermount3` (or `fusermount`) program; most desktops have it, and it doesn't need the old FUSE 2 library. Install it, then start {{app}} again:

- Ubuntu, Debian: `sudo apt install fuse3`
- Fedora: `sudo dnf install fuse3`
- Arch: `sudo pacman -S fuse3`

Without FUSE, `~/Applications/{{app}}.AppImage --appimage-extract-and-run` starts it too, a little slower.

**It mentions the sandbox ("chrome-sandbox", "SUID sandbox").** Ubuntu 23.10 and later only let listed apps use the user namespaces that Chromium's sandbox needs. {{app}} never turns the sandbox off. Use the `.deb`, which lists itself, or list the AppImage once (the install script prints these commands when it's needed):

```
printf '%s\n' 'abi <abi/4.0>,' 'include <tunables/global>' 'profile {{linuxExe}}-appimage /tmp/{.mount_*,appimage_extracted_*}/{{linuxExe}} flags=(unconfined) {' '  userns,' '}' | sudo tee /etc/apparmor.d/{{linuxExe}}-appimage
sudo apparmor_parser -r /etc/apparmor.d/{{linuxExe}}-appimage
```

## Keys that do nothing

Input methods can take some keys before {{app}} sees them. IBus, the default on GNOME, opens its emoji picker with Super+., Ctrl+. or Ctrl+Shift+E, depending on its version and settings, and Ctrl+Shift+U types Unicode characters, so {{app}} doesn't use that one. If **Open in editor** or **Hide or show Quick actions** don't respond to their keys, use their buttons, or turn the input method's shortcut off: run `ibus-setup` and clear it on the **Emoji** tab (on GNOME 46 and later, Settings › Keyboard › Keyboard Shortcuts may list it instead).

## Wayland and X11

{{app}} uses Wayland when your session does and X11 otherwise; you don't need to choose. If the window misbehaves on Wayland (blurry with fractional scaling, a wrong icon, missing title bar buttons), start it on X11 to compare: `~/Applications/{{app}}.AppImage --ozone-platform=x11` (or `{{linuxExe}} --ozone-platform=x11` with the `.deb`).

## The Changes count updates slowly

Linux limits how many folders a user may watch for changes (inotify), and editors, Claude Code and file sync tools share that limit. When it's used up, {{app}} says so once and checks the Changes count every few seconds instead. To raise it:

```
echo fs.inotify.max_user_watches=524288 | sudo tee /etc/sysctl.d/90-inotify.conf
sudo sysctl --system
```

## Your environment

{{app}} reads your login shell's environment at startup, so `claude`, `git` and the rest are found as in a terminal: bash reads `~/.bash_profile` (or `~/.profile`), zsh `~/.zprofile` and `~/.zshrc`, fish its `config.fish`. Terminals inside {{app}} start your shell as your terminal app does.
