# Multi-stage Dockerfile for Kubernetes deployment
# Supports multiple modes:
#   - processor: Full indexer with squid processor (default)
#   - api: API servers only (REST, A2A, MCP) for CQL-read nodes
#   - graphql: GraphQL server only
#
# Set MODE environment variable to select mode

FROM oven/bun:1 AS builder

WORKDIR /squid

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source and schema
COPY . .

# Build TypeScript to lib/
RUN bun run build

# Production image
FROM oven/bun:1-slim

WORKDIR /squid

# Copy package files and install production deps only
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Copy compiled output and required files from builder
COPY --from=builder /squid/lib ./lib
COPY --from=builder /squid/api ./api
COPY --from=builder /squid/schema.graphql ./schema.graphql
COPY --from=builder /squid/db ./db
COPY --from=builder /squid/commands.json ./commands.json

# Create non-root user
RUN groupadd -g 1001 squid && \
    useradd -u 1001 -g squid squid && \
    chown -R squid:squid /squid

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
    CQL_SYNC_ENABLED=false \
    CQL_READ_ENABLED=false

# Entrypoint script to handle different modes
COPY --from=builder /squid/scripts/docker-entrypoint.sh /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]

# Default command (processor mode)
CMD ["processor"]
