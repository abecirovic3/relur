#!/usr/bin/env bash
# Part of scripts/linux-package-check-run.sh, as the desktop user: starts the
# app ($1) on its own X display and checks its window's class is the desktop
# entry's StartupWMClass ($2), and that Chromium's sandbox is on: renderers
# and their zygote run in a user namespace of their own.
set -uo pipefail
app=$1
class=$2
Xvfb :41 >/dev/null 2>&1 &
xvfb=$!
DISPLAY=:41 dbus-launch --exit-with-session "$app" >/dev/null 2>&1 &
started=$!
for _ in $(seq 1 60); do
  DISPLAY=:41 xwininfo -root -tree 2>/dev/null | grep -q "\"$class\"" && break
  sleep 0.5
done
DISPLAY=:41 xwininfo -root -tree | grep -m1 "\"$class\""
found=$?
sleep 1
main=$(pgrep -u "$(id -u)" -o -f -- "^[^ ]*/$class\$" || true)
sandboxed=0
[ -n "$main" ] || echo "no main process found"
# Renderers, and the sandboxed zygote they fork from (under emulation renderers
# keep the zygote's command line).
for pid in $(pgrep -u "$(id -u)" -f -- "^[^ ]*/$class --type=(renderer|zygote)( |\$)" ); do
  grep -qa -- --no-zygote-sandbox "/proc/$pid/cmdline" && continue
  [ -n "$main" ] || break
  own=$(readlink "/proc/$pid/ns/user") || continue
  if [ "$own" != "$(readlink "/proc/$main/ns/user")" ]; then sandboxed=1; fi
done
echo "main process $main; sandboxed processes in a user namespace of their own: $sandboxed"
kill "$started" 2>/dev/null
pkill -u "$(id -u)" -f -- "^[^ ]*/$class" 2>/dev/null
sleep 2
kill "$xvfb" 2>/dev/null
[ "$found" = 0 ] && [ "$sandboxed" = 1 ]
