# Bazaar - Unified DeFi + NFT Marketplace
# Build from repo root: docker build -f apps/bazaar/Dockerfile .

FROM oven/bun:latest AS base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace files
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
COPY scripts/shared/ ./scripts/shared/

RUN bun install

# Copy app source
COPY apps/bazaar/ ./apps/bazaar/

# Build the app
WORKDIR /app/apps/bazaar
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN bun run build

# Production stage
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --create-home nextjs

WORKDIR /app

# Copy built application
COPY --from=builder --chown=nextjs:nodejs /app/apps/bazaar/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/bazaar/.next/static ./apps/bazaar/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/bazaar/public ./apps/bazaar/public

USER nextjs

EXPOSE 4006

ENV PORT=4006
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:4006/api/health || exit 1

CMD ["node", "apps/bazaar/server.js"]
