FROM oven/bun:1 AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./
COPY apps/facilitator/package.json ./apps/facilitator/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source
COPY apps/facilitator ./apps/facilitator
COPY packages ./packages
COPY scripts ./scripts

# Build
WORKDIR /app/apps/facilitator
RUN bun run build

# Runtime stage
FROM oven/bun:1-slim

WORKDIR /app

# Copy built files
COPY --from=builder /app/apps/facilitator/dist ./dist
COPY --from=builder /app/apps/facilitator/package.json ./
COPY --from=builder /app/node_modules ./node_modules

# Expose port
EXPOSE 3402

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:3402/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Run
CMD ["bun", "run", "dist/index.js"]
