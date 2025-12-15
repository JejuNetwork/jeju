# Jeju Oracle Network Node
# Multi-stage build for production deployment

FROM oven/bun:1.1-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./
COPY apps/gateway/package.json ./apps/gateway/
COPY packages/config/oracle/ ./packages/config/oracle/

# Install dependencies
RUN cd apps/gateway && bun install --frozen-lockfile

# Copy source
COPY apps/gateway/src ./apps/gateway/src

# Production stage
FROM oven/bun:1.1-alpine AS runner

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S oracle && \
    adduser -S oracle -u 1001 -G oracle

# Copy built application
COPY --from=builder /app/apps/gateway ./apps/gateway
COPY --from=builder /app/packages/config ./packages/config
COPY --from=builder /app/node_modules ./node_modules

# Set ownership
RUN chown -R oracle:oracle /app

USER oracle

WORKDIR /app/apps/gateway

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost:${METRICS_PORT:-9090}/health || exit 1

# Default environment
ENV NODE_ENV=production
ENV METRICS_PORT=9090

EXPOSE 9090

ENTRYPOINT ["bun", "run", "src/oracle-server.ts"]
CMD ["--network=mainnet"]
