# Dockerfile for Phala TEE Deployment
#
# This builds the autonomous game runner for deployment on Phala Network.
# When running inside a Phala CVM (Confidential VM):
#   - Keys are derived from hardware (Intel TDX)
#   - Attestation is cryptographically verifiable
#   - No secrets leave the enclave
#
# Build:
#   docker build -t babylon-autonomous-game .
#
# Run locally (simulation mode):
#   docker run -e CONTRACT_ADDRESS=0x... babylon-autonomous-game
#
# Deploy to Phala:
#   phala deploy --image babylon-autonomous-game --wallet $WALLET

FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install 

# Copy source
COPY . .

# Build TypeScript
RUN bun run build

# Production image
FROM oven/bun:1-alpine

WORKDIR /app

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules

# DStack expects the app to listen on 8080
EXPOSE 8080

# Environment variables (set at runtime)
ENV NODE_ENV=production
ENV CONTRACT_ADDRESS=""
ENV RPC_URL="https://ethereum-sepolia.publicnode.com"
ENV CHAIN_ID="sepolia"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost:8080/health || exit 1

# Start the autonomous runner
CMD ["bun", "run", "dist/autonomous/production.js"]

