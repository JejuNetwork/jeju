# Jeju Cache Service
# Redis-compatible decentralized cache with TEE support

FROM oven/bun:1.1-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json ./
COPY tsconfig.json ./

# Install dependencies
RUN bun install

# Copy source
COPY src/ ./src/

# Build
RUN bun build ./src/index.ts --outdir=./dist --target=bun --minify

# Runtime stage
FROM oven/bun:1.1-alpine

WORKDIR /app

# Copy built files
COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/node_modules/ ./node_modules/
COPY --from=builder /app/package.json ./

# Create data directory
RUN mkdir -p /data && chown -R bun:bun /data

USER bun

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget -q -O- http://localhost:${CACHE_SERVICE_PORT:-4015}/health || exit 1

EXPOSE 4015

CMD ["bun", "run", "dist/index.js"]
