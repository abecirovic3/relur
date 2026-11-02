#!/usr/bin/env bash
# Sets up a Linux host (the release's Ubuntu 24.04 runners) as a user's
# machine is after following install.sh's notes, before
# scripts/linux-package-check.sh tries the AppImage there. Ubuntu 23.10 and
# later set kernel.apparmor_restrict_unprivileged_userns=1: user namespaces,
# which Chromium's sandbox needs, only for programs with an AppArmor profile.
# The check's container shares the host's kernel, so it has the restriction
# too. Uses sudo; changes the host, so it's for throwaway runners only.
#
# 1. As a user does: install.sh --from the AppImage in dist/, run the AppArmor
#    commands it prints, and remove the app again.
# 2. Evidence that the profile works: the AppImage's AppRun runs
#    `unshare -Ur true` and adds --no-sandbox when it fails, so a stand-in
#    AppRun at a path the profile lists must pass that on the host, where
#    plain `unshare -Ur true` is refused. If it doesn't, install.sh's
#    commands are wrong, and this fails.
# 3. The same inside a container like the check's. Only if the profile works
#    on the host but not there: allow user namespaces on the host instead
#    (sysctl ...=0), as on a system without the restriction, so the check
#    still tries the sandbox the app really uses. Never --no-sandbox.
set -euo pipefail
cd "$(dirname "$0")/.."

restriction=/proc/sys/kernel/apparmor_restrict_unprivileged_userns
if [ "$(cat "$restriction" 2>/dev/null || true)" != 1 ]; then
  echo "user namespaces aren't restricted on this host: nothing to do"
  exit 0
fi

arch=$(uname -m | sed 's/x86_64/x64/; s/aarch64/arm64/')
appimage=$(ls dist/*-linux-"$arch".AppImage)

echo "== install.sh --from $appimage"
notes=$(timeout 300 sh install.sh --from "$appimage" --yes)
printf '%s\n' "$notes"
timeout 120 sh install.sh --uninstall --yes >/dev/null
# The indented lines after "list it once:".
commands=$(printf '%s\n' "$notes" | awk '/list it once:$/ { on = 1; next } on && /^  / { print substr($0, 3); next } { on = 0 }')
if [ -z "$commands" ]; then
  echo "FAILED: user namespaces are restricted here, and install.sh printed no AppArmor commands"
  exit 1
fi
echo
echo "== the AppArmor commands install.sh printed"
while IFS= read -r command; do
  echo "+ $command"
  timeout 60 sh -c "$command"
done <<<"$commands"

# A stand-in for the AppImage's AppRun, in a folder like its FUSE mount's.
stand_in='mkdir -p /tmp/.mount_probe && printf "#!/bin/sh\nexec unshare -Ur true\n" >/tmp/.mount_probe/AppRun && chmod 755 /tmp/.mount_probe/AppRun'
echo
echo "== AppRun's user namespace check, on this host"
if unshare -Ur true 2>/dev/null; then
  echo "FAILED: unshare -Ur true works here although $restriction is 1"
  exit 1
fi
sh -c "$stand_in"
if ! /tmp/.mount_probe/AppRun; then
  echo "FAILED: with install.sh's AppArmor profile, AppRun's unshare -Ur true is still refused:" \
    "the AppImage would start with --no-sandbox"
  exit 1
fi
echo "unshare -Ur true is refused, and works from /tmp/.mount_probe/AppRun: the profile is in effect"

# As the check's container runs (scripts/linux-package-check.sh), as a user.
in_container() {
  timeout 300 docker run --rm --security-opt seccomp=unconfined --security-opt apparmor=unconfined \
    ubuntu:24.04 sh -c "$stand_in && runuser -u ubuntu -- $1" >/dev/null 2>&1
}
echo
echo "== and inside a container"
if in_container 'unshare -Ur true'; then
  echo "unshare -Ur true works in the container: the restriction doesn't reach it"
elif in_container /tmp/.mount_probe/AppRun; then
  echo "unshare -Ur true is refused in the container, and works from /tmp/.mount_probe/AppRun: the profile is in effect"
else
  # The profile works on the host (above) but doesn't reach the container's
  # programs. Then the check can only try the sandbox with the restriction off.
  echo "::warning::The AppArmor profile from install.sh works on the host but not in the check's" \
    "container. Allowing user namespaces on the host instead, so the check still tries Chromium's sandbox."
  sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
fi
