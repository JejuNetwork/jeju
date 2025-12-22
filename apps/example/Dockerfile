# Example App - Decentralized App Template
# Multi-stage build for production deployment

# Build stage
FROM oven/bun:1.1-alpine AS builder

WORKDIR /app

# Copy root package files
COPY package.json bun.lock ./
COPY packages/db/package.json ./packages/db/
COPY packages/config/package.json ./packages/config/
COPY packages/shared/package.json ./packages/shared/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/types/package.json ./packages/types/
COPY packages/kms/package.json ./packages/kms/
COPY packages/oauth3/package.json ./packages/oauth3/
COPY apps/example/package.json ./apps/example/

# Install dependencies (ignore preinstall scripts that may fail)
RUN bun install --frozen-lockfile --ignore-scripts || bun install --ignore-scripts

# Copy source code
COPY packages/db ./packages/db
COPY packages/config ./packages/config
COPY packages/shared ./packages/shared
COPY packages/sdk ./packages/sdk
COPY packages/types ./packages/types
COPY packages/kms ./packages/kms
COPY packages/oauth3 ./packages/oauth3
COPY apps/example ./apps/example
COPY tsconfig.json ./

# Build
WORKDIR /app/apps/example
RUN bun run build

# Production stage
FROM oven/bun:1.1-alpine AS production

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S example -u 1001 -G nodejs

# Copy built artifacts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/example/dist ./apps/example/dist
COPY --from=builder /app/apps/example/src ./apps/example/src
COPY --from=builder /app/apps/example/package.json ./apps/example/

# Set ownership
RUN chown -R example:nodejs /app

USER example

WORKDIR /app/apps/example

# Expose ports (API, Frontend)
EXPOSE 4500 4501

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:4500/health || exit 1

# Default command
CMD ["bun", "run", "start"]

