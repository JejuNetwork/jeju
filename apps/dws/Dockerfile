FROM oven/bun:1.3-alpine AS builder

# Install Python and setuptools for native deps
RUN apk add --no-cache python3 py3-setuptools

WORKDIR /app

# Copy workspace root files
COPY package.json bun.lockb ./
COPY patches/ ./patches/

# Copy all workspace package.json files for dependency resolution
COPY packages/types/package.json ./packages/types/
COPY packages/config/package.json ./packages/config/
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/kms/package.json ./packages/kms/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/auth/package.json ./packages/auth/
COPY apps/dws/package.json ./apps/dws/

# Install all dependencies (not using --frozen-lockfile because we're copying a subset of the monorepo)
RUN bun install

# Copy source files
COPY packages/types/ ./packages/types/
COPY packages/config/ ./packages/config/
COPY packages/shared/ ./packages/shared/
COPY packages/db/ ./packages/db/
COPY packages/kms/ ./packages/kms/
COPY packages/sdk/ ./packages/sdk/
COPY packages/auth/ ./packages/auth/
COPY apps/dws/ ./apps/dws/
COPY tsconfig.json ./

# Build packages that export dist
# Delete any pre-existing dist folders to ensure fresh builds
RUN rm -rf packages/types/dist packages/config/dist packages/shared/dist packages/db/dist packages/kms/dist
RUN cd packages/types && bun x tsc || true
RUN cd packages/config && bun x tsc || true
RUN cd packages/shared && bun x tsc || true
RUN cd packages/db && bun x tsc || true
RUN cd packages/kms && bun x tsc || true

# Production stage
FROM oven/bun:1.3-alpine

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
