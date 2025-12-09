# Babylon Compute Node
# 
# A TEE-compatible inference server for the Babylon compute marketplace.
# Supports local development and Phala Cloud deployment.
#
# Build from packages/experimental:
#   docker build -t babylon-compute-node -f docker/Dockerfile .
#
# Run:
#   docker run -p 8080:8080 -e PRIVATE_KEY=0x... babylon-compute-node

FROM oven/bun:1.1-alpine

WORKDIR /app

# Install curl for health checks
RUN apk add --no-cache curl

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile || bun install

# Copy source code
COPY src ./src
COPY tsconfig.json ./

# Use the existing bun user (UID 1000) for security
USER bun

# Environment variables (override at runtime)
ENV PORT=8080
ENV RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
ENV MODEL_BACKEND=mock
ENV MODEL_NAME=babylon-inference
ENV REQUIRE_AUTH=false

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:${PORT}/health || exit 1

# Expose port
EXPOSE 8080

# Run compute node
CMD ["bun", "run", "src/compute/node/index.ts"]
