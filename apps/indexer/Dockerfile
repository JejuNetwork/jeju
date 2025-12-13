# Multi-stage Dockerfile for Kubernetes deployment
# Optimized for the working squid indexer

FROM node:20-slim AS builder

# Install build tools for native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /squid

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install

# Copy source and schema
COPY . .

# Build TypeScript
RUN npm run build

# Generate code from schema (may fail if no schema)
RUN npx sqd codegen || echo "No codegen needed"

# Production image
FROM node:20-slim

WORKDIR /squid

# Install build tools for native modules in production too
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files and install production deps only
COPY package.json package-lock.json* ./
RUN npm install --production && \
    apt-get purge -y python3 make g++ && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

# Copy built artifacts from builder
COPY --from=builder /squid/lib ./lib
COPY --from=builder /squid/schema.graphql ./schema.graphql
COPY --from=builder /squid/db ./db
COPY --from=builder /squid/commands.json ./commands.json
COPY --from=builder /squid/src ./src

# Create non-root user
RUN groupadd -g 1001 squid && \
    useradd -u 1001 -g squid squid && \
    chown -R squid:squid /squid

USER squid

EXPOSE 4350

# Default command (processor)
CMD ["node", "lib/main.js"]
