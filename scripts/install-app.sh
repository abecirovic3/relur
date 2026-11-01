#!/bin/sh
# Builds the app for this machine and installs it with install.sh (README,
# Build from source): quits the running app after asking, and points the
# command line tool at it. On a Mac it replaces the app in /Applications (or
# ~/Applications) and, like install.sh, quits and removes the app under its
# previous name, and its launcher. On Linux it packages the AppImage and
# installs it in ~/Applications with its desktop entry (spec §15.6). Run it
# from a terminal outside the app.
#   npm run install-app [-- --yes]
set -eu
cd "$(dirname "$0")/.."
case "$(uname -s)" in
  Darwin)
    if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = 1 ]; then arch=arm64; else arch=x64; fi
    platform=mac
    ;;
  Linux)
    case "$(uname -m)" in aarch64 | arm64) arch=arm64 ;; *) arch=x64 ;; esac
    platform=linux
    ;;
  *) echo "install-app builds for macOS and Linux" >&2; exit 1 ;;
esac
npm run build
npx tsx --tsconfig tsconfig.node.json scripts/package.ts --platform "$platform" --arch "$arch"
sh install.sh --from dist "$@"
