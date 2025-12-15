# Dockerfile for Jeju Compute Services
#
# Services:
#   - compute-node: AI inference + GPU rentals
#   - workers: Serverless JavaScript runtime
#   - mpc: Threshold signing
#
# Runs on any TEE provider (Phala, Marlin, Oasis) or standard infrastructure.
#
# Build:
#   docker build -t jeju-compute .
#
# Run services:
#   docker run -e SERVICE=node jeju-compute
#   docker run -e SERVICE=workers jeju-compute
#   docker run -e SERVICE=mpc jeju-compute

FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy workspace files for dependencies
COPY package.json bun.lock* ./
COPY ../../packages/kms/package.json ./packages/kms/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Build TypeScript
RUN bun run build || true

# Production image
FROM oven/bun:1-alpine

WORKDIR /app

# Install curl for health checks
RUN apk add --no-cache curl

# Copy source and dependencies (Bun runs TypeScript directly)
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules

# Expose ports for all services
EXPOSE 4007 4010 4020 8080

# Environment variables (set at runtime)
ENV NODE_ENV=production
ENV SERVICE=node
ENV COMPUTE_PORT=4007
ENV MPC_PORT=4010
ENV WORKER_SERVER_PORT=4020
ENV RPC_URL=""
ENV COMPUTE_REGISTRY_ADDRESS=""
ENV WORKER_REGISTRY_ADDRESS=""

# Health check (adapts to service)
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -sf http://localhost:${COMPUTE_PORT:-4007}/health || exit 1

# Entrypoint script
COPY <<'EOF' /app/entrypoint.sh
#!/bin/sh
set -e

case "$SERVICE" in
  node)
    echo "Starting Compute Node on port ${COMPUTE_PORT:-4007}..."
    exec bun run src/compute/node/index.ts
    ;;
  workers)
    echo "Starting Worker Runtime on port ${WORKER_SERVER_PORT:-4020}..."
    exec bun run src/compute/workers/server.ts
    ;;
  mpc)
    echo "Starting MPC Node on port ${MPC_PORT:-4010}..."
    exec bun run src/mpc/mpc-server.ts
    ;;
  all)
    echo "Starting all services..."
    bun run src/compute/node/index.ts &
    bun run src/compute/workers/server.ts &
    bun run src/mpc/mpc-server.ts &
    wait
    ;;
  *)
    echo "Unknown service: $SERVICE"
    echo "Available: node, workers, mpc, all"
    exit 1
    ;;
esac
EOF

RUN chmod +x /app/entrypoint.sh

CMD ["/app/entrypoint.sh"]

