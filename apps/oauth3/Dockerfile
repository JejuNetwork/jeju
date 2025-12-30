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
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/shared/package.json ./packages/shared/
COPY packages/tests/package.json ./packages/tests/
COPY packages/types/package.json ./packages/types/
COPY packages/token/package.json ./packages/token/
COPY packages/sqlit/package.json ./packages/sqlit/
COPY packages/ui/package.json ./packages/ui/
COPY packages/training/package.json ./packages/training/
COPY packages/messaging/package.json ./packages/messaging/
COPY apps/oauth3/package.json ./apps/oauth3/

# Install all dependencies
RUN bun install --ignore-scripts

# Copy source files
COPY packages/ ./packages/
COPY apps/oauth3/ ./apps/oauth3/
COPY tsconfig.json tsconfig.base.json ./

# Re-run install to properly link workspaces after copying source
RUN bun install --ignore-scripts

# Production stage
FROM --platform=linux/amd64 oven/bun:1.3

WORKDIR /app

# Copy everything from builder including properly linked node_modules
COPY --from=builder /app ./

WORKDIR /app/apps/oauth3

# Expose ports
EXPOSE 4200

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -q -O- http://localhost:4200/health || exit 1

# Set environment
ENV NODE_ENV=production
ENV PORT=4200

# Run
CMD ["bun", "run", "api/index.ts"]
