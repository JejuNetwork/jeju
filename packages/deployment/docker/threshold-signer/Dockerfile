# Threshold Signer Service
# Individual signer node in the threshold signature scheme
#
# Each sequencer operator runs one of these to participate in batch signing

FROM oven/bun:1.1.44 AS base

WORKDIR /app

# Dependencies stage
FROM base AS deps

COPY package.json bun.lock* ./
COPY packages/deployment/package.json ./packages/deployment/
COPY packages/config/package.json ./packages/config/

RUN bun install --frozen-lockfile

# Builder stage
FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/deployment/node_modules ./packages/deployment/node_modules
COPY --from=deps /app/packages/config/node_modules ./packages/config/node_modules

COPY packages/deployment ./packages/deployment
COPY packages/config ./packages/config

# Runner stage
FROM base AS runner

WORKDIR /app

ENV NODE_ENV=production

# Non-root user
RUN addgroup --system --gid 1001 signer && \
    adduser --system --uid 1001 signer

COPY --from=builder --chown=signer:signer /app/packages/deployment ./packages/deployment
COPY --from=builder --chown=signer:signer /app/packages/config ./packages/config
COPY --from=builder --chown=signer:signer /app/node_modules ./node_modules

USER signer

EXPOSE 8081

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8081/health || exit 1

ENTRYPOINT ["bun", "run", "packages/deployment/scripts/sequencer/signer-service.ts"]
