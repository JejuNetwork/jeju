FROM --platform=linux/amd64 oven/bun:1.3 AS builder

# Install Python and setuptools for native deps
RUN apt-get update && apt-get install -y python3 python3-setuptools && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace root files
COPY package.json bun.lockb ./
COPY patches/ ./patches/

# Copy all workspace package.json files for dependency resolution
COPY packages/api/package.json ./packages/api/
COPY packages/auth/package.json ./packages/auth/
COPY packages/config/package.json ./packages/config/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/db/package.json ./packages/db/
COPY packages/kms/package.json ./packages/kms/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/shared/package.json ./packages/shared/
COPY packages/tests/package.json ./packages/tests/
COPY packages/training/package.json ./packages/training/
COPY packages/types/package.json ./packages/types/
COPY packages/ui/package.json ./packages/ui/
COPY packages/token/package.json ./packages/token/
COPY packages/sqlit/package.json ./packages/sqlit/
COPY apps/dws/package.json ./apps/dws/

# Install all dependencies (not using --frozen-lockfile because we're copying a subset of the monorepo)
RUN bun install --ignore-scripts

# Copy source files
COPY packages/api/ ./packages/api/
COPY packages/auth/ ./packages/auth/
COPY packages/config/ ./packages/config/
COPY packages/contracts/ ./packages/contracts/
COPY packages/db/ ./packages/db/
COPY packages/kms/ ./packages/kms/
COPY packages/sdk/ ./packages/sdk/
COPY packages/shared/ ./packages/shared/
COPY packages/tests/ ./packages/tests/
COPY packages/training/ ./packages/training/
COPY packages/types/ ./packages/types/
COPY packages/ui/ ./packages/ui/
COPY packages/token/ ./packages/token/
COPY packages/sqlit/ ./packages/sqlit/
COPY apps/dws/ ./apps/dws/
COPY tsconfig.json tsconfig.base.json ./

# Build packages that export dist
RUN cd packages/types && bun x tsc || true
RUN cd packages/config && bun x tsc || true
RUN cd packages/api && bun x tsc || true
RUN cd packages/shared && bun x tsc || true
RUN cd packages/db && bun x tsc || true
RUN cd packages/kms && bun x tsc || true
RUN cd packages/sdk && bun x tsc || true

# Production stage
FROM --platform=linux/amd64 oven/bun:1.3

WORKDIR /app

# Copy built app and node_modules
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/dws ./apps/dws
COPY --from=builder /app/tsconfig.json ./

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
