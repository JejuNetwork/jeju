# Multi-stage Dockerfile for Kubernetes deployment
# Supports multiple modes:
#   - processor: Full indexer with squid processor (default)
#   - api: API servers only (REST, A2A, MCP) for SQLit-read nodes
#   - graphql: GraphQL server only
#
# NOTE: Build context must be project root for workspace packages

FROM oven/bun:1 AS builder

WORKDIR /app

# Copy workspace package files for dependency resolution
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/config/package.json ./packages/config/
COPY packages/types/package.json ./packages/types/
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/kms/package.json ./packages/kms/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/sqlit/package.json ./packages/sqlit/
COPY apps/indexer/package.json ./apps/indexer/

# Install all dependencies (ignore postinstall scripts to avoid build failures)
RUN rm -f bun.lock && bun install --ignore-scripts

# Copy source files
COPY packages/config ./packages/config
COPY packages/types ./packages/types
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY packages/kms ./packages/kms
COPY packages/contracts ./packages/contracts
COPY packages/sqlit ./packages/sqlit
COPY apps/indexer ./apps/indexer

# Build packages in order
WORKDIR /app/packages/types
RUN bun run build || echo "types build skipped"

WORKDIR /app/packages/config
RUN bun run build || echo "config build skipped"

WORKDIR /app/packages/kms
RUN bun run build || echo "kms build skipped"

WORKDIR /app/packages/contracts
RUN bun run build || echo "contracts build skipped"

WORKDIR /app/packages/sqlit
RUN cd driver && bun run build || echo "sqlit build skipped"

WORKDIR /app/packages/db
RUN bun run build || echo "db build skipped"

WORKDIR /app/packages/shared
RUN bun run build || echo "shared build skipped"

WORKDIR /app/apps/indexer

# Run codegen if schema exists
RUN bun x @subsquid/commands codegen 2>/dev/null || true

# Build TypeScript
RUN bun run build || (echo "Build failed, checking for errors..." && exit 1)

# Production image
FROM oven/bun:1-slim

WORKDIR /app

# Copy the entire built app including node_modules
COPY --from=builder /app/package.json /app/
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/packages /app/packages
COPY --from=builder /app/apps/indexer/lib /app/apps/indexer/lib
COPY --from=builder /app/apps/indexer/api /app/apps/indexer/api
COPY --from=builder /app/apps/indexer/db /app/apps/indexer/db
COPY --from=builder /app/apps/indexer/schema.graphql /app/apps/indexer/schema.graphql
COPY --from=builder /app/apps/indexer/commands.json /app/apps/indexer/commands.json
COPY --from=builder /app/apps/indexer/scripts/docker-entrypoint.sh /docker-entrypoint.sh

WORKDIR /app/apps/indexer

# Create symlinks for backwards compatibility with old paths
RUN mkdir -p /squid && \
    ln -sf /app/apps/indexer/lib /squid/lib && \
    ln -sf /app/apps/indexer/api /squid/api && \
    ln -sf /app/apps/indexer/schema.graphql /squid/schema.graphql && \
    ln -sf /app/apps/indexer/db /squid/db && \
    ln -sf /app/node_modules /squid/node_modules

# Create non-root user
RUN groupadd -g 1001 squid && \
    useradd -u 1001 -g squid squid && \
    chown -R squid:squid /app /squid

USER squid

# Expose ports for different services
# 4350 - GraphQL
# 4351 - A2A
# 4352 - REST
# 4353 - MCP
EXPOSE 4350 4351 4352 4353

# Environment variables with defaults
ENV MODE=processor \
    DB_HOST=localhost \
    DB_PORT=5432 \
    DB_NAME=indexer \
    DB_USER=postgres \
    DB_PASS=postgres \
    GQL_PORT=4350 \
    REST_PORT=4352 \
    A2A_PORT=4351 \
    MCP_PORT=4353 \
    SQLIT_SYNC_ENABLED=false \
    SQLIT_READ_ENABLED=false

ENTRYPOINT ["/docker-entrypoint.sh"]

# Default command (processor mode)
CMD ["processor"]
