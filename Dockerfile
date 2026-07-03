# ── Build stage ──────────────────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /app

# Install with only the workspaces the image needs (docs excluded).
COPY package.json package-lock.json ./
COPY packages/bot/package.json packages/bot/
COPY packages/dashboard/package.json packages/dashboard/
RUN npm ci --include-workspace-root -w @claude-discord/bot -w @claude-discord/dashboard

COPY tsconfig.base.json ./
COPY packages ./packages
RUN npm run build \
  && npm prune --omit=dev -w @claude-discord/bot --include-workspace-root \
  # Ensure the dir exists even when npm hoisted everything to the root.
  && mkdir -p packages/bot/node_modules

# ── Runtime stage ────────────────────────────────────────────────────────
FROM node:22-slim

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
