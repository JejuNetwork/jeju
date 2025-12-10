# Leaderboard - Analytics and Rankings
# Next.js production build with database migrations

FROM oven/bun:1.1-slim AS base

# Install system dependencies including build tools and PostgreSQL client
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    postgresql-client \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies stage
FROM base AS deps
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile --production

# Builder stage
FROM base AS builder
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

# Copy source
COPY . .
COPY --from=deps /app/node_modules ./node_modules

# Generate Drizzle client
RUN bun run db:generate

# Build Next.js
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN bun run build

# Production stage
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --create-home nextjs

# Copy built application
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./
COPY --from=builder --chown=nextjs:nodejs /app/drizzle.config.ts ./

# Copy migration script
COPY --chown=nextjs:nodejs <<'EOF' /app/migrate.sh
#!/bin/sh
set -e
echo "Running database migrations..."
bun run db:migrate
echo "Migrations complete!"
EOF
RUN chmod +x /app/migrate.sh

USER nextjs

EXPOSE 5012

ENV PORT=5012
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:5012/api/health || exit 1

# Run migrations before starting server
CMD ["/bin/sh", "-c", "/app/migrate.sh && node server.js"]

