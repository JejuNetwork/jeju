# IPFS Pinning Service with x402 Payments
# Bun runtime with IPFS node integration

FROM oven/bun:1.1-slim AS base

# Install system dependencies including build tools
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies
FROM base AS deps
COPY package.json bun.lockb* ./
COPY pinning-api/package.json ./pinning-api/
RUN bun install --frozen-lockfile --production

# Builder
FROM base AS builder
COPY package.json bun.lockb* ./
COPY pinning-api/package.json ./pinning-api/
RUN bun install --frozen-lockfile

COPY . .

# Production
FROM base AS runner
ENV NODE_ENV=production

# Create non-root user
RUN groupadd --gid 1001 ipfs && \
    useradd --uid 1001 --gid ipfs --create-home ipfs

# Copy application
COPY --from=builder --chown=ipfs:ipfs /app ./

# Create IPFS data directory
RUN mkdir -p /app/.ipfs && chown -R ipfs:ipfs /app/.ipfs

USER ipfs

EXPOSE 5020

ENV IPFS_PORT=5020
ENV IPFS_PATH=/app/.ipfs

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:5020/health || exit 1

CMD ["bun", "run", "pinning-api/src/index.ts"]

