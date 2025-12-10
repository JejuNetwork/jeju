# Intents - OIF Aggregator, Solver, and Viewer
# Multi-component build for cross-chain intent processing

FROM oven/bun:1.1-slim AS base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace dependency files
FROM base AS deps
COPY package.json bun.lockb* ./
COPY aggregator/package.json ./aggregator/
COPY solver/package.json ./solver/
COPY viewer/package.json ./viewer/
RUN bun install --frozen-lockfile

# Build stage
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/aggregator/node_modules ./aggregator/node_modules
COPY --from=deps /app/solver/node_modules ./solver/node_modules
COPY --from=deps /app/viewer/node_modules ./viewer/node_modules

# Copy source code
COPY . .

# Build all components
ENV NODE_ENV=production
RUN bun run build

# Aggregator service
FROM base AS aggregator
ENV NODE_ENV=production
WORKDIR /app

RUN groupadd --gid 1001 intents && \
    useradd --uid 1001 --gid intents --create-home intents

COPY --from=builder --chown=intents:intents /app/aggregator/dist ./dist
COPY --from=builder --chown=intents:intents /app/aggregator/package.json ./
COPY --from=builder --chown=intents:intents /app/node_modules ./node_modules

USER intents

EXPOSE 4010

ENV PORT=4010
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:4010/health || exit 1

CMD ["bun", "run", "dist/index.js"]

# Solver service  
FROM base AS solver
ENV NODE_ENV=production
WORKDIR /app

RUN groupadd --gid 1001 intents && \
    useradd --uid 1001 --gid intents --create-home intents

COPY --from=builder --chown=intents:intents /app/solver/dist ./dist
COPY --from=builder --chown=intents:intents /app/solver/package.json ./
COPY --from=builder --chown=intents:intents /app/node_modules ./node_modules

USER intents

EXPOSE 4011

ENV PORT=4011
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:4011/health || exit 1

CMD ["bun", "run", "dist/index.js"]

# Viewer (Next.js)
FROM base AS viewer
ENV NODE_ENV=production
WORKDIR /app

RUN groupadd --gid 1001 intents && \
    useradd --uid 1001 --gid intents --create-home intents

COPY --from=builder --chown=intents:intents /app/viewer/.next/standalone ./
COPY --from=builder --chown=intents:intents /app/viewer/.next/static ./.next/static
COPY --from=builder --chown=intents:intents /app/viewer/public ./public

USER intents

EXPOSE 4012

ENV PORT=4012
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:4012/api/health || exit 1

CMD ["node", "server.js"]

