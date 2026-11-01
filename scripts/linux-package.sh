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
# No mounted output folder: on a Linux host it belongs to the host's uid, not
# the container's node user. docker cp writes as the user running it, so the
# packages belong to the host's user on Linux and on Docker Desktop alike.
container=$(docker create ${platform_args[@]+"${platform_args[@]}"} -e VERSION="${VERSION:-}" "$image")
trap 'docker rm -f "$container" >/dev/null' EXIT
docker start -a "$container"
docker cp "$container:/home/node/out/." dist/
(cd dist && ls -l -- *-linux-*.AppImage *-linux-*.deb)
