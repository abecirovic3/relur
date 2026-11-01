FROM node:22-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
      git xvfb xauth build-essential python3 zsh fish dbus \
      libgtk-3-0 libnss3 libatk-bridge2.0-0 libdrm2 libgbm1 libasound2 \
      libxss1 libxshmfence1 libxkbcommon0 libx11-xcb1 \
    && rm -rf /var/lib/apt/lists/*
# Same npm major as on the dev machine, so allowScripts behaves the same.
RUN npm install -g npm@11.18.0

USER node
WORKDIR /home/node/app
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node scripts/postinstall.mjs scripts/
RUN npm ci && node -e 'require("electron")'
COPY --chown=node:node . .

CMD ["bash", "scripts/linux-check-run.sh"]
