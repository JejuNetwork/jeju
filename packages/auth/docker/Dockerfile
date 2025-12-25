# OAuth3 Auth Agent Dockerfile
# 
# Build and run the OAuth3 TEE agent with MPC support
#
# Build: docker build -t oauth3-agent -f docker/Dockerfile .
# Run:   docker run -p 4200:4200 -e CHAIN_ID=420690 oauth3-agent

FROM oven/bun:1.1-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git

# Copy package files first for better layer caching
COPY package.json bun.lockb* ./

# Install dependencies
RUN bun install --frozen-lockfile --production=false

# Copy TypeScript config and source
COPY tsconfig.json ./
COPY src/ ./src/

# Type check and build
RUN bun run build

# Production stage
FROM oven/bun:1.1-alpine AS runtime

WORKDIR /app

# Install runtime dependencies only
RUN apk add --no-cache \
    ca-certificates \
    wget \
    tini

# Copy package.json and install production deps only
COPY package.json ./
RUN bun install --frozen-lockfile --production

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src

# Create non-root user for security
RUN addgroup -g 1001 -S oauth3 && \
    adduser -u 1001 -S oauth3 -G oauth3

# Create data directory for sessions/cache
RUN mkdir -p /data && chown oauth3:oauth3 /data

# Switch to non-root user
USER oauth3

# Environment defaults
ENV OAUTH3_PORT=4200 \
    CHAIN_ID=420691 \
    TEE_MODE=simulated \
    MPC_ENABLED=false \
    MPC_THRESHOLD=2 \
    MPC_TOTAL_PARTIES=3 \
    NODE_ENV=production

# Expose the OAuth3 agent port
EXPOSE 4200

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost:${OAUTH3_PORT}/health || exit 1

# Use tini for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start the agent
CMD ["bun", "run", "src/tee/dstack-agent.ts"]
