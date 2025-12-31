# Autocrat - AI-Powered Autonomous Governance
FROM --platform=linux/amd64 oven/bun:1.3 AS builder

# Install Python and setuptools for native deps
RUN apt-get update && apt-get install -y python3 python3-setuptools && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace root files
COPY package.json bun.lockb ./
COPY patches/ ./patches/

# Copy all workspace package.json files for dependency resolution
COPY packages/api/package.json ./packages/api/
COPY packages/auth/package.json ./packages/auth/
COPY packages/config/package.json ./packages/config/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/db/package.json ./packages/db/
COPY packages/kms/package.json ./packages/kms/
COPY packages/messaging/package.json ./packages/messaging/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/shared/package.json ./packages/shared/
COPY packages/tests/package.json ./packages/tests/
COPY packages/training/package.json ./packages/training/
COPY packages/types/package.json ./packages/types/
COPY packages/ui/package.json ./packages/ui/
COPY packages/token/package.json ./packages/token/
COPY packages/sqlit/package.json ./packages/sqlit/
COPY apps/autocrat/package.json ./apps/autocrat/
COPY apps/dws/package.json ./apps/dws/

# Install all dependencies
RUN bun install --ignore-scripts

# Copy source files
COPY packages/ ./packages/
COPY apps/autocrat/ ./apps/autocrat/
COPY apps/dws/ ./apps/dws/
COPY tsconfig.json tsconfig.base.json ./

# Build frontend for production
WORKDIR /app/apps/autocrat
RUN bun run scripts/build.ts

# Production stage
FROM --platform=linux/amd64 oven/bun:1.3

WORKDIR /app

# Copy everything from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/autocrat ./apps/autocrat
COPY --from=builder /app/tsconfig.json ./

WORKDIR /app/apps/autocrat

# Expose ports (API: 4040)
EXPOSE 4040

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -q -O- http://localhost:4040/health || exit 1

# Set environment
ENV NODE_ENV=production
ENV PORT=4040

# Run the server (serves both API and static frontend)
CMD ["bun", "run", "api/server.ts"]
