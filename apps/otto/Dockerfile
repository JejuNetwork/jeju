# Otto - Decentralized Multi-Platform AI Trading Agent
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
COPY apps/otto/package.json ./apps/otto/

# Install dependencies
RUN bun install --frozen-lockfile --ignore-scripts || bun install --ignore-scripts

# Copy source code
COPY packages/db ./packages/db
COPY packages/config ./packages/config
COPY packages/shared ./packages/shared
COPY packages/sdk ./packages/sdk
COPY packages/types ./packages/types
COPY packages/kms ./packages/kms
COPY packages/oauth3 ./packages/oauth3
COPY apps/otto ./apps/otto
COPY tsconfig.json ./

# Build
WORKDIR /app/apps/otto
RUN bun run build

# Production stage
FROM oven/bun:1.1-alpine AS production

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S otto -u 1001 -G nodejs

# Copy built artifacts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/otto/dist ./apps/otto/dist
COPY --from=builder /app/apps/otto/package.json ./apps/otto/

# Create data directory
RUN mkdir -p /app/apps/otto/data && chown -R otto:nodejs /app

USER otto

WORKDIR /app/apps/otto

# Expose ports (API, Webhooks)
EXPOSE 4040 4041

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:4040/health || exit 1

# Default command
CMD ["bun", "run", "start"]
