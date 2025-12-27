# Autocrat - AI-Powered Autonomous Governance
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
COPY apps/autocrat/package.json ./apps/autocrat/

# Install dependencies (ignore preinstall scripts that may fail)
RUN bun install --frozen-lockfile --ignore-scripts || bun install --ignore-scripts

# Copy source code
COPY packages/db ./packages/db
COPY packages/config ./packages/config
COPY packages/shared ./packages/shared
COPY packages/sdk ./packages/sdk
COPY packages/types ./packages/types
COPY apps/autocrat ./apps/autocrat
COPY tsconfig.json ./

# Build
WORKDIR /app/apps/autocrat
RUN bun run build

# Production stage
FROM oven/bun:1.1-alpine AS production

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S autocrat -u 1001 -G nodejs

# Copy built artifacts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/autocrat/dist ./apps/autocrat/dist
COPY --from=builder /app/apps/autocrat/src ./apps/autocrat/src
COPY --from=builder /app/apps/autocrat/package.json ./apps/autocrat/

# Set ownership
RUN chown -R autocrat:nodejs /app

USER autocrat

WORKDIR /app/apps/autocrat

# Expose ports (API: 4040, Web: 4042, Agent: 4041)
EXPOSE 4040 4041 4042

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:4040/health || exit 1

# Default command
CMD ["bun", "run", "start"]

