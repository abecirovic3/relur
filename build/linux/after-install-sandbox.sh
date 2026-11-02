
# Appended to electron-builder's after-install script by scripts/package.ts,
# which fills in electron-builder's placeholders here too (a dollar sign and
# a name in braces). So shell variables are written $name, never in braces.
#
# Chromium's sandbox for every user (spec §15.6). The check above runs
# `unshare --user` as root, which works where a user's doesn't: on Ubuntu
# 23.10 and later a user needs the AppArmor profile, and inside a container
# (distrobox, toolbox, Docker) on such a host, or in a chroot, it can't be
# loaded. Chromium then falls back to chrome-sandbox, which must be setuid
# root, or it aborts. So: when a user can't create a user namespace and the
# profile isn't loaded, make chrome-sandbox setuid root.
sandbox_helper='/opt/${sanitizedProductName}/chrome-sandbox'
if command -v setpriv >/dev/null 2>&1 &&
  ! setpriv --reuid=65534 --regid=65534 --clear-groups unshare --user --map-root-user true >/dev/null 2>&1 &&
  ! grep -qs '^${executable} ' /sys/kernel/security/apparmor/profiles; then
  chown root:root "$sandbox_helper" && chmod 4755 "$sandbox_helper" || true
fi
