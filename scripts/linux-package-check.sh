#!/usr/bin/env bash
# Builds the Linux packages (scripts/linux-package.sh) and tries them on a
# plain Ubuntu 24.04 in Docker: install.sh with the AppImage (desktop entry,
# icons, launcher), the AppImage's self-test with FUSE and without, its
# window class, --uninstall, and the .deb through apt. Chromium's sandbox
# stays on: the container gets user namespaces (seccomp=unconfined) and
# /dev/fuse, as a desktop has, never --no-sandbox.
# PLATFORM=linux/amd64 checks x64 on an arm64 host. SKIP_BUILD=1 reuses dist/.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${SKIP_BUILD:-}" ]]; then scripts/linux-package.sh; fi

image=desktop-app-linux-package-check${PLATFORM:+-${PLATFORM//\//-}}
platform_args=()
if [[ -n "${PLATFORM:-}" ]]; then platform_args=(--platform "$PLATFORM"); fi

docker build ${platform_args[@]+"${platform_args[@]}"} -f scripts/linux-package-check.Dockerfile -t "$image" .
docker run --rm --shm-size=1g ${platform_args[@]+"${platform_args[@]}"} \
  --security-opt seccomp=unconfined --security-opt apparmor=unconfined \
  --device /dev/fuse --cap-add SYS_ADMIN \
  -v "$PWD/dist:/dist:ro" "$image"
