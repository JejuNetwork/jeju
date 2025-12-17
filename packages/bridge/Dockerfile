# ZKSolBridge Production Dockerfile
# Multi-stage build for minimal image size

# =============================================================================
# Stage 1: Build
# =============================================================================
FROM oven/bun:1.1 AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy package files first for better caching
COPY package.json bun.lockb ./
COPY tsconfig.json ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source
COPY src/ ./src/
COPY types/ ./types/

# Build TypeScript
RUN bun run build

# =============================================================================
# Stage 2: Production
# =============================================================================
FROM oven/bun:1.1-slim AS production

WORKDIR /app

# Install runtime dependencies only
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r bridge && useradd -r -g bridge bridge

# Copy built artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Set ownership
RUN chown -R bridge:bridge /app

# Switch to non-root user
USER bridge

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8081}/monitoring/health || exit 1

# Default environment
ENV NODE_ENV=production
ENV PORT=8081
ENV LOG_LEVEL=info

# Expose ports
EXPOSE 8080 8081

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["relayer"]

