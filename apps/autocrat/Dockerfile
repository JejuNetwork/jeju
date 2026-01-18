# Autocrat - AI-Powered Autonomous Governance
# Build from repo root: docker build -f apps/autocrat/Dockerfile .

FROM oven/bun:latest AS base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy all source files needed for workspace install
COPY package.json bun.lockb ./
COPY apps/autocrat/package.json ./apps/autocrat/
COPY packages/config/package.json ./packages/config/
COPY packages/types/package.json ./packages/types/
COPY packages/shared/package.json ./packages/shared/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/db/package.json ./packages/db/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/messaging/package.json ./packages/messaging/
COPY packages/agents/package.json ./packages/agents/
COPY packages/a2a/package.json ./packages/a2a/
COPY packages/mcp/package.json ./packages/mcp/
COPY packages/auth/package.json ./packages/auth/
COPY packages/kms/package.json ./packages/kms/
COPY packages/api/package.json ./packages/api/
COPY packages/ui/package.json ./packages/ui/
COPY packages/bots/package.json ./packages/bots/
COPY packages/sqlit/package.json ./packages/sqlit/
COPY packages/token/package.json ./packages/token/
COPY packages/workerd/package.json ./packages/workerd/
COPY packages/tests/package.json ./packages/tests/
COPY packages/eliza-plugin/package.json ./packages/eliza-plugin/
COPY packages/training/package.json ./packages/training/
COPY packages/bridge/package.json ./packages/bridge/
COPY packages/cache/package.json ./packages/cache/
COPY packages/deployment/package.json ./packages/deployment/
COPY packages/solana/package.json ./packages/solana/
COPY packages/monitoring/package.json ./packages/monitoring/

# Copy all apps package.json for workspace
COPY apps/dws/package.json ./apps/dws/
COPY apps/gateway/package.json ./apps/gateway/
COPY apps/bazaar/package.json ./apps/bazaar/
COPY apps/crucible/package.json ./apps/crucible/
COPY apps/factory/package.json ./apps/factory/
COPY apps/indexer/package.json ./apps/indexer/
COPY apps/node/package.json ./apps/node/
COPY apps/wallet/package.json ./apps/wallet/
COPY apps/oauth3/package.json ./apps/oauth3/
COPY apps/otto/package.json ./apps/otto/
COPY apps/vpn/package.json ./apps/vpn/
COPY apps/documentation/package.json ./apps/documentation/

# Install all dependencies (ignore scripts that require native builds)
RUN bun install --ignore-scripts

# Copy source code
COPY apps/autocrat/ ./apps/autocrat/
COPY packages/config/ ./packages/config/
COPY packages/types/ ./packages/types/
COPY packages/shared/ ./packages/shared/
COPY packages/contracts/ ./packages/contracts/
COPY packages/db/ ./packages/db/
COPY packages/sdk/ ./packages/sdk/
COPY packages/messaging/ ./packages/messaging/
COPY packages/agents/ ./packages/agents/
COPY packages/a2a/ ./packages/a2a/
COPY packages/mcp/ ./packages/mcp/
COPY packages/auth/ ./packages/auth/
COPY packages/kms/ ./packages/kms/
COPY packages/api/ ./packages/api/
COPY packages/ui/ ./packages/ui/
COPY packages/bots/ ./packages/bots/
COPY tsconfig.json tsconfig.base.json ./

# Create non-root user
RUN groupadd --gid 1001 autocrat && \
    useradd --uid 1001 --gid autocrat --create-home autocrat

# Fix permissions
RUN chown -R autocrat:autocrat /app

USER autocrat

EXPOSE 4040

ENV NODE_ENV=production
ENV PORT=4040
ENV HOSTNAME="0.0.0.0"
ENV JEJU_NETWORK=testnet

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:4040/health || exit 1

WORKDIR /app/apps/autocrat

# Run the server directly with Bun
CMD ["bun", "run", "api/server.ts"]
