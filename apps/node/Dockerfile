# Jeju Node Docker Image
# Multi-stage build for production deployment

# Build stage
FROM oven/bun:1.3 AS builder

WORKDIR /app

# Copy workspace files
COPY package.json bun.lockb ./
COPY patches/ ./patches/
COPY apps/node/package.json ./apps/node/
COPY packages/config/package.json ./packages/config/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/shared/package.json ./packages/shared/
COPY packages/types/package.json ./packages/types/

# Install dependencies
RUN bun install

# Copy source code
COPY apps/node/ ./apps/node/
COPY packages/config/ ./packages/config/
COPY packages/contracts/ ./packages/contracts/
COPY packages/shared/ ./packages/shared/
COPY packages/types/ ./packages/types/

# Build the app
WORKDIR /app/apps/node
RUN bun build src/app/index.ts --outfile=dist/app --target=bun --minify

# Production stage
FROM oven/bun:1.3-slim AS runtime

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r jeju && useradd -r -g jeju jeju

# Copy built app
COPY --from=builder /app/apps/node/dist/app /app/app
COPY --from=builder /app/apps/node/src/app/index.ts /app/src/app/index.ts
COPY --from=builder /app/apps/node/package.json /app/

# Create data directory
RUN mkdir -p /data /home/jeju/.jeju-node && \
    chown -R jeju:jeju /app /data /home/jeju

USER jeju

# Environment variables
ENV JEJU_NETWORK=testnet
ENV JEJU_LOG_LEVEL=info
ENV HOME=/home/jeju

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Expose ports
EXPOSE 8080 9090

# Run app
ENTRYPOINT ["bun", "run", "/app/src/app/index.ts"]
CMD ["start"]

