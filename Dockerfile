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
