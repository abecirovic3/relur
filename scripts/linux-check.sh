#!/usr/bin/env bash
# Builds and launches the app on Linux in Docker: npm ci, typecheck, tests,
# production build, then a headless launch under xvfb (--self-test).
# Set PLATFORM=linux/amd64 to check x64 on an arm64 host.
set -euo pipefail
cd "$(dirname "$0")/.."

# One image per platform, so arm64 and x64 runs never pick up each other's build.
image=desktop-app-linux-check${PLATFORM:+-${PLATFORM//\//-}}
platform_args=()
if [[ -n "${PLATFORM:-}" ]]; then platform_args=(--platform "$PLATFORM"); fi

docker build ${platform_args[@]+"${platform_args[@]}"} -f scripts/linux-check.Dockerfile -t "$image" .
# Docker's default 64 MB /dev/shm is too small for Chromium: its network service
# crashed on a dev-mode reload and the page never loaded again. Docker's
# seccomp profile blocks the user namespaces Chromium's sandbox needs; without
# it the sandbox stays on, as on a desktop, and no run needs --no-sandbox.
docker run --rm --shm-size=1g ${platform_args[@]+"${platform_args[@]}"} \
  --security-opt seccomp=unconfined "$image"
