# Builds the Linux packages (spec §15.6). Debian 11's glibc 2.31 is the
# oldest the packages need: node-pty is compiled here, against it, so they run
# on Ubuntu 22.04, Debian 12 and later. Used by scripts/linux-package.sh and
# the release workflow.
FROM node:22-bullseye

RUN apt-get update && apt-get install -y --no-install-recommends \
      git build-essential python3 \
    && rm -rf /var/lib/apt/lists/*
# Same npm major as on the dev machine, so allowScripts behaves the same.
RUN npm install -g npm@11.18.0

USER node
WORKDIR /home/node/app
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node scripts/postinstall.mjs scripts/
RUN npm ci
COPY --chown=node:node . .

# The version from the release tag, when given (VERSION=1.2.3).
CMD ["sh", "-c", "if [ -n \"${VERSION:-}\" ]; then npm version --no-git-tag-version --allow-same-version \"$VERSION\" >/dev/null; fi && npm run build && npx tsx --tsconfig tsconfig.node.json scripts/package.ts --platform linux && mkdir -p /out && cp dist/*-linux-*.AppImage dist/*-linux-*.deb /out/"]
