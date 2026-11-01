#!/usr/bin/env bash
# Builds the Linux AppImage and .deb in Docker (scripts/linux-package.Dockerfile)
# into dist/, for this machine's architecture, or PLATFORM=linux/amd64 or
# linux/arm64. node-pty is compiled for the architecture it is built on, so
# each architecture is built on its own (spec §15.6). VERSION=1.2.3 sets the
# app's version.
set -euo pipefail
cd "$(dirname "$0")/.."

image=desktop-app-linux-package${PLATFORM:+-${PLATFORM//\//-}}
platform_args=()
if [[ -n "${PLATFORM:-}" ]]; then platform_args=(--platform "$PLATFORM"); fi

docker build ${platform_args[@]+"${platform_args[@]}"} -f scripts/linux-package.Dockerfile -t "$image" .
mkdir -p dist
docker run --rm ${platform_args[@]+"${platform_args[@]}"} -e VERSION="${VERSION:-}" \
  -v "$PWD/dist:/out" "$image"
(cd dist && ls -- *-linux-*.AppImage *-linux-*.deb)
