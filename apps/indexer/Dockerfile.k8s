# Multi-stage Dockerfile for Kubernetes deployment
# Optimized for the working squid indexer

FROM node:20-alpine AS builder

WORKDIR /squid

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci

# Copy source and schema
COPY . .

# Build TypeScript
RUN npm run build

# Generate code from schema
RUN npx sqd codegen

# Production image
FROM node:20-alpine

WORKDIR /squid

# Copy package files and install production deps only
COPY package.json package-lock.json* ./
RUN npm ci --production

# Copy built artifacts from builder
COPY --from=builder /squid/lib ./lib
COPY --from=builder /squid/src/model ./src/model
COPY --from=builder /squid/schema.graphql ./schema.graphql
COPY --from=builder /squid/db ./db
COPY --from=builder /squid/commands.json ./commands.json

# Create non-root user
RUN addgroup -g 1001 squid && \
    adduser -D -u 1001 -G squid squid && \
    chown -R squid:squid /squid

USER squid

EXPOSE 4350

# Default command (processor)
CMD ["node", "lib/main.js"]

