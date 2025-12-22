# Bazaar - Unified DeFi + NFT Marketplace
# Build from repo root: docker build -f apps/bazaar/Dockerfile .
#
# Architecture:
# - Static frontend served from /app/dist/static (for CDN/IPFS deployment)
# - Elysia API worker at /app/dist/worker (for DWS worker deployment)

FROM oven/bun:latest AS base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies stage
FROM base AS deps
COPY package.json bun.lockb ./
COPY apps/bazaar/package.json ./apps/bazaar/
COPY packages/config/package.json ./packages/config/
COPY packages/types/package.json ./packages/types/
COPY packages/contracts/package.json ./packages/contracts/

# Install all workspace dependencies
RUN bun install --production

# Build stage
FROM base AS builder
COPY package.json bun.lockb ./
COPY apps/bazaar/package.json ./apps/bazaar/
COPY packages/ ./packages/

RUN bun install

# Copy app source
COPY apps/bazaar/ ./apps/bazaar/

# Build the app (static frontend + API worker)
WORKDIR /app/apps/bazaar
ENV NODE_ENV=production
RUN bun run build

# Production stage - serves static files and API
FROM base AS runner
ENV NODE_ENV=production

# Create non-root user
RUN groupadd --gid 1001 bazaar && \
    useradd --uid 1001 --gid bazaar --create-home bazaar

WORKDIR /app

# Copy built application
COPY --from=builder --chown=bazaar:bazaar /app/apps/bazaar/dist ./dist
COPY --from=builder --chown=bazaar:bazaar /app/apps/bazaar/scripts/serve.ts ./serve.ts
COPY --from=builder --chown=bazaar:bazaar /app/node_modules ./node_modules
COPY --from=builder --chown=bazaar:bazaar /app/packages ./packages

USER bazaar

EXPOSE 4006

ENV PORT=4006
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:4006/health || exit 1

# Serve static files with Elysia and proxy API to worker
CMD ["bun", "run", "serve.ts"]
