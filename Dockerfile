# ── Makora Shared App Worker ─────────────────────────────────────────
# Runs the trading agent using Cloudflare's open-source workerd runtime
# (bundled with wrangler). No Cloudflare account required.
#
# Build:  docker build -t makora-worker .
# Run:    docker run -p 8788:8788 --env-file .env.docker makora-worker
# ─────────────────────────────────────────────────────────────────────

FROM node:22-slim

# workerd (inside wrangler) needs these for the native binary
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies (includes wrangler + workerd)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and config
COPY tsconfig.json biome.json ./
COPY src/ src/
COPY migrations/ migrations/
COPY wrangler-app.jsonc ./

# Build TypeScript
RUN npm run build

# Copy entrypoint
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Persist Durable Object state across container restarts
VOLUME /app/.wrangler/state

EXPOSE 8788

ENTRYPOINT ["/docker-entrypoint.sh"]
