#!/usr/bin/env bash
# Part of scripts/linux-package-check-run.sh, as the desktop user: starts the
# app ($1) on its own X display and checks its window's class is the desktop
# entry's StartupWMClass ($2), and that Chromium's sandbox is on: renderers
# and their zygote run in a user namespace of their own. Every wait is
# bounded: an app that crashes or hangs fails the check with its output.
set -uo pipefail
app=$1
class=$2
display=:41
log=$(mktemp)
xvfb=
started=

stop() {
  # The app first, so it quits as it does on logout; then whatever is left.
  if [ -n "$started" ]; then
    kill -TERM "$started" 2>/dev/null
    for _ in $(seq 1 10); do kill -0 -- "-$started" 2>/dev/null || break; sleep 0.5; done
    kill -TERM -- "-$started" 2>/dev/null
    sleep 1
    kill -KILL -- "-$started" 2>/dev/null
  fi
  [ -z "$xvfb" ] || kill "$xvfb" 2>/dev/null
  wait 2>/dev/null
}
fail() {
  echo "FAILED: $*"
  echo "-- the app's processes:"
  app_procs | sed 's/^/   /'
  echo "-- the app's output (last 40 lines):"
  tail -n 40 "$log" | sed 's/^/   /'
  stop
  exit 1
}
# This user's processes whose argv[0] is the app, as "pid command line": the
# AppImage runs it from /tmp/.mount_* (or /tmp/appimage_extracted_* without
# FUSE), the .deb from /opt; under emulation too, where /proc/<pid>/exe is qemu.
app_procs() {
  local dir cmd
  for dir in /proc/[0-9]*; do
    [ -O "$dir" ] || continue
    cmd=$(tr '\0' ' ' <"$dir/cmdline" 2>/dev/null) || continue
    case "${cmd%% *}" in */"$class") printf '%s %s\n' "${dir#/proc/}" "$cmd" ;; esac
  done
}
# The browser process: the app's process without --type=.
main_pid() { app_procs | grep -v -- ' --type=' | sort -n | head -n1 | cut -d' ' -f1; }
alive() { kill -0 "$started" 2>/dev/null; }
trap 'fail "stopped from outside (time limit)"' TERM INT

Xvfb "$display" >/dev/null 2>&1 &
xvfb=$!
for _ in $(seq 1 20); do DISPLAY=$display xdpyinfo >/dev/null 2>&1 && break; sleep 0.5; done
DISPLAY=$display xdpyinfo >/dev/null 2>&1 || fail "Xvfb didn't start on $display"

# In a session of its own, so stop() ends the app and everything it started.
DISPLAY=$display setsid dbus-launch --exit-with-session "$app" >"$log" 2>&1 &
started=$!

window=
for _ in $(seq 1 120); do
  alive || fail "the app ended before showing its window"
  window=$(DISPLAY=$display timeout 5 xwininfo -root -tree 2>/dev/null | grep -m1 "\"$class\"")
  [ -n "$window" ] && break
  sleep 0.5
done
[ -n "$window" ] || fail "no window with class \"$class\" within 60 seconds"
echo "$window"

# Renderers, and the sandboxed zygote they fork from (under emulation renderers
# keep the zygote's command line), each in a user namespace that isn't the
# browser process's. Polled: the first renderer can follow the window.
main=
sandboxed=0
for _ in $(seq 1 60); do
  alive || fail "the app ended after showing its window"
  main=$(main_pid)
  if [ -n "$main" ] && main_ns=$(readlink "/proc/$main/ns/user"); then
    while read -r pid cmd; do
      case " $cmd " in *" --type=renderer "* | *" --type=zygote "*) ;; *) continue ;; esac
      case " $cmd " in *" --no-zygote-sandbox "*) continue ;; esac
      own=$(readlink "/proc/$pid/ns/user") || continue
      [ "$own" = "$main_ns" ] || sandboxed=1
    done < <(app_procs)
  fi
  [ "$sandboxed" = 1 ] && break
  sleep 0.5
done
[ -n "$main" ] || fail "no browser process: none of this user's processes runs .../$class without --type="
echo "main process $main; sandboxed processes in a user namespace of their own: $sandboxed"
# electron-builder's AppRun adds --no-sandbox when `unshare -Ur true` fails.
case " $(tr '\0' ' ' <"/proc/$main/cmdline" 2>/dev/null) " in
  *" --no-sandbox "*) fail "the app was started with --no-sandbox: AppRun's \`unshare -Ur true\` failed" ;;
esac
[ "$sandboxed" = 1 ] || fail "no renderer or zygote in a user namespace of its own: Chromium's sandbox isn't on"
stop
