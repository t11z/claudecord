# ── Build stage ──────────────────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /app

# better-sqlite3 is native. It normally installs a prebuilt binary that
# prebuild-install downloads from GitHub — a network step, and an
# unauthenticated one, so it can be rate-limited. When that download fails,
# npm falls back to compiling from source with node-gyp, which needs
# python3/make/g++. node:22-slim ships none of them, so a transient blip turned
# into a hard build failure (seen on the v1.4.1 tag: "gyp ERR! find Python").
#
# Keeping the toolchain here makes that fallback actually work: a failed
# download costs build time instead of the whole release. Build stage only —
# the runtime stage below copies node_modules and dist, never this layer, so
# the shipped image is byte-for-byte unaffected.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Install with only the workspaces the image needs (docs excluded).
COPY package.json package-lock.json ./
COPY packages/bot/package.json packages/bot/
COPY packages/dashboard/package.json packages/dashboard/
# Retried once: a prebuild download or registry hiccup shouldn't send us down
# the (much slower, QEMU-emulated on the arm64 leg) source-build path if simply
# asking again would do. `npm ci` clears node_modules first, so the second
# attempt starts clean.
RUN npm ci --include-workspace-root -w @claudecord/bot -w @claudecord/dashboard \
  || npm ci --include-workspace-root -w @claudecord/bot -w @claudecord/dashboard

COPY tsconfig.base.json ./
COPY packages ./packages
RUN npm run build \
  && npm prune --omit=dev -w @claudecord/bot --include-workspace-root \
  # Ensure the dir exists even when npm hoisted everything to the root.
  && mkdir -p packages/bot/node_modules

# ── Runtime stage ────────────────────────────────────────────────────────
FROM node:22-slim

# Release version, injected by the Release workflow from the git tag. Defaults
# to "dev" for local `docker build` so the dashboard never reports a stale
# package.json version.
ARG APP_VERSION=dev

# git + gh power the optional GitHub integration: when a token is configured,
# agentic threads can clone, push and open PRs on the repos it reaches.
# gh isn't in Debian, so pull it from GitHub's own apt repository.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git gnupg \
  && mkdir -p -m 755 /etc/apt/keyrings \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
     -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
     > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1001 bot
WORKDIR /app

ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    DATA_DIR=/data \
    DASHBOARD_HOST=0.0.0.0 \
    DASHBOARD_PORT=3000 \
    # Safe because docker-compose maps the port to the host's loopback only.
    DASHBOARD_INSECURE_BIND=true

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/bot/package.json ./packages/bot/package.json
COPY --from=build /app/packages/bot/node_modules ./packages/bot/node_modules
COPY --from=build /app/packages/bot/dist ./packages/bot/dist
COPY --from=build /app/packages/bot/public ./packages/bot/public

RUN mkdir -p /data /home/bot/.claude && chown -R bot:bot /data /home/bot/.claude /app
USER bot

# /data: SQLite + secrets + workspaces. /home/bot/.claude: Claude Code's
# session storage — without this volume, conversations forget on restart.
VOLUME ["/data", "/home/bot/.claude"]
EXPOSE 3000

CMD ["node", "packages/bot/dist/index.js"]
