# Factory - Developer Coordination Hub
# Multi-stage build for production deployment

# Build stage
FROM oven/bun:1.1-alpine AS builder

WORKDIR /app

# Copy root package files
COPY package.json bun.lock ./
COPY packages/config/package.json ./packages/config/
COPY packages/shared/package.json ./packages/shared/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/auth/package.json ./packages/auth/
COPY apps/factory/package.json ./apps/factory/

# Install dependencies (ignore preinstall scripts that may fail)
RUN bun install --frozen-lockfile --ignore-scripts || bun install --ignore-scripts

# Copy source code
COPY packages/config ./packages/config
COPY packages/shared ./packages/shared
COPY packages/sdk ./packages/sdk
COPY packages/contracts ./packages/contracts
COPY packages/auth ./packages/auth
COPY apps/factory ./apps/factory
COPY tsconfig.json ./

# Build
WORKDIR /app/apps/factory
RUN bun run build

# Production stage
FROM oven/bun:1.1-alpine AS production

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S factory -u 1001 -G nodejs

# Copy built artifacts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/factory/dist ./apps/factory/dist
COPY --from=builder /app/apps/factory/src ./apps/factory/src
COPY --from=builder /app/apps/factory/package.json ./apps/factory/

# Set ownership
RUN chown -R factory:nodejs /app

USER factory

WORKDIR /app/apps/factory

# Expose port
EXPOSE 4009

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:4009/api/health || exit 1

# Default command
CMD ["bun", "run", "start"]

