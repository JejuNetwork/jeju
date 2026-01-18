FROM --platform=linux/amd64 oven/bun:1.3 AS builder

# Install Python, setuptools, and jq for native deps and workspace filtering
RUN apt-get update && apt-get install -y python3 python3-setuptools jq && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace root files
COPY package.json bun.lock ./
COPY patches/ ./patches/

# Copy all workspace package.json files for dependency resolution
COPY packages/api/package.json ./packages/api/
COPY packages/auth/package.json ./packages/auth/
COPY packages/config/package.json ./packages/config/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/db/package.json ./packages/db/
COPY packages/kms/package.json ./packages/kms/
COPY packages/a2a/package.json ./packages/a2a/
COPY packages/agents/package.json ./packages/agents/
COPY packages/bridge/package.json ./packages/bridge/
COPY packages/mcp/package.json ./packages/mcp/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/shared/package.json ./packages/shared/
COPY packages/tests/package.json ./packages/tests/
COPY packages/training/package.json ./packages/training/
COPY packages/types/package.json ./packages/types/
COPY packages/ui/package.json ./packages/ui/
COPY packages/token/package.json ./packages/token/
COPY packages/sqlit/package.json ./packages/sqlit/
COPY packages/cache/package.json ./packages/cache/
COPY packages/durable-objects/package.json ./packages/durable-objects/
COPY apps/dws/package.json ./apps/dws/

# Filter workspaces to only include packages used by DWS
RUN jq '.workspaces = ["packages/*", "apps/dws"]' package.json > package.tmp && mv package.tmp package.json

# Install all dependencies (not using --frozen-lockfile because we're copying a subset of the monorepo)
RUN bun install --ignore-scripts

# Copy source files
COPY packages/api/ ./packages/api/
COPY packages/auth/ ./packages/auth/
COPY packages/config/ ./packages/config/
COPY packages/contracts/ ./packages/contracts/
COPY packages/db/ ./packages/db/
COPY packages/kms/ ./packages/kms/
COPY packages/a2a/ ./packages/a2a/
COPY packages/agents/ ./packages/agents/
COPY packages/bridge/ ./packages/bridge/
COPY packages/mcp/ ./packages/mcp/
COPY packages/sdk/ ./packages/sdk/
COPY packages/shared/ ./packages/shared/
COPY packages/tests/ ./packages/tests/
COPY packages/training/ ./packages/training/
COPY packages/types/ ./packages/types/
COPY packages/ui/ ./packages/ui/
COPY packages/token/ ./packages/token/
COPY packages/sqlit/ ./packages/sqlit/
COPY packages/cache/ ./packages/cache/
COPY packages/durable-objects/ ./packages/durable-objects/
COPY apps/dws/ ./apps/dws/
COPY tsconfig.json tsconfig.base.json ./

# Build packages that export dist (order matters for dependencies)
# First build contracts (no dependencies)
RUN cd packages/contracts && bun run build || true

# Then build types and config (depend on contracts)
RUN cd packages/types && bun x tsc || true
RUN cd packages/config && bun x tsc || true

# Then build core packages (depend on types/config/contracts)
RUN cd packages/db && bun x tsc || true
RUN cd packages/shared && bun x tsc || true
RUN cd packages/auth && bun x tsc || true
RUN cd packages/api && bun x tsc || true
RUN cd packages/kms && bun x tsc || true
# Skip SDK typecheck in Docker build to avoid long-running tsc in CI/K8s image builds
RUN cd packages/cache && bun x tsc || true

# Build DWS web frontend
WORKDIR /app/apps/dws
# Debug: check if build.web.ts exists
RUN ls -la && echo "--- Checking build file ---"
# Set NETWORK env var for frontend build to use correct API URLs
RUN NETWORK=testnet bun ./build.web.ts

# Production stage
FROM --platform=linux/amd64 oven/bun:1.3

# Install workerd runtime for V8 isolate execution.
# workerd requires glibc, which is available in the bun base image.
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -Lo /tmp/workerd.gz https://github.com/cloudflare/workerd/releases/download/v1.20251231.0/workerd-linux-64.gz && \
    gunzip /tmp/workerd.gz && \
    mv /tmp/workerd /usr/local/bin/workerd && \
    chmod +x /usr/local/bin/workerd && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built app and node_modules
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/dws ./apps/dws
COPY --from=builder /app/tsconfig.json ./

# Recreate workspace symlinks (Docker COPY doesn't preserve symlinks correctly)
RUN mkdir -p node_modules/@jejunetwork && \
    rm -rf node_modules/@jejunetwork/config node_modules/@jejunetwork/types node_modules/@jejunetwork/shared \
           node_modules/@jejunetwork/contracts node_modules/@jejunetwork/api node_modules/@jejunetwork/auth \
           node_modules/@jejunetwork/db node_modules/@jejunetwork/cache node_modules/@jejunetwork/kms \
           node_modules/@jejunetwork/sdk node_modules/@jejunetwork/workerd 2>/dev/null || true && \
    ln -sf ../../packages/config node_modules/@jejunetwork/config && \
    ln -sf ../../packages/types node_modules/@jejunetwork/types && \
    ln -sf ../../packages/shared node_modules/@jejunetwork/shared && \
    ln -sf ../../packages/contracts node_modules/@jejunetwork/contracts && \
    ln -sf ../../packages/api node_modules/@jejunetwork/api && \
    ln -sf ../../packages/auth node_modules/@jejunetwork/auth && \
    ln -sf ../../packages/db node_modules/@jejunetwork/db && \
    ln -sf ../../packages/cache node_modules/@jejunetwork/cache && \
    ln -sf ../../packages/kms node_modules/@jejunetwork/kms && \
    ln -sf ../../packages/sdk node_modules/@jejunetwork/sdk && \
    ln -sf ../../packages/workerd node_modules/@jejunetwork/workerd

WORKDIR /app/apps/dws

# Expose ports (HTTP, P2P, metrics)
EXPOSE 4030 4031 4032

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -q -O- http://localhost:4030/health || exit 1

# Set environment
ENV NODE_ENV=production
ENV DWS_PORT=4030

# Run
CMD ["bun", "run", "api/server/index.ts"]
