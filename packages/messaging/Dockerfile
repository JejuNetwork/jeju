# Jeju Messaging Relay Node Dockerfile
FROM oven/bun:1.1-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Build TypeScript
RUN bun run build

# ============ Production Image ============

FROM oven/bun:1.1-alpine

WORKDIR /app

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# Environment
ENV NODE_ENV=production
ENV PORT=3200

EXPOSE 3200

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3200/health || exit 1

# Run relay node
CMD ["bun", "run", "dist/node/server.js"]

