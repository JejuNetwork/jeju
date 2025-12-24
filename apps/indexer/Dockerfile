# Multi-stage Dockerfile for Kubernetes deployment
# Optimized for the working squid indexer

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
COPY --from=builder /squid/schema.graphql ./schema.graphql
COPY --from=builder /squid/db ./db
COPY --from=builder /squid/commands.json ./commands.json

# Create non-root user
RUN groupadd -g 1001 squid && \
    useradd -u 1001 -g squid squid && \
    chown -R squid:squid /squid

USER squid

EXPOSE 4350

# Default command (processor using compiled output)
CMD ["bun", "lib/main.js"]
