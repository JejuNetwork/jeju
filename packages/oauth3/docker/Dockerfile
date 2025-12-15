# OAuth3 Auth Agent Dockerfile
FROM oven/bun:1.1-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

# Copy source
COPY src/ ./src/
COPY tsconfig.json ./

# Build (type check)
RUN bun run typecheck

# Production stage
FROM oven/bun:1.1-alpine

WORKDIR /app

# Copy built application
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./

# Create non-root user
RUN addgroup -g 1001 -S oauth3 && \
    adduser -u 1001 -S oauth3 -G oauth3

# Create data directory
RUN mkdir -p /data && chown oauth3:oauth3 /data

USER oauth3

# Expose port
EXPOSE 4200

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost:${OAUTH3_PORT:-4200}/health || exit 1

# Start agent
CMD ["bun", "run", "src/tee/dstack-agent.ts"]
