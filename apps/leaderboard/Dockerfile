# Leaderboard - Analytics and Rankings
# Next.js production build with database migrations

FROM node:20-slim AS base

# Install system dependencies including build tools and PostgreSQL client
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    postgresql-client \
    python3 \
    make \
    g++ \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

WORKDIR /app

# Builder stage
FROM base AS builder
WORKDIR /app/apps/leaderboard

# Copy package files
COPY apps/leaderboard/package.json ./

# Install dependencies with npm (better native module support)
RUN npm install --legacy-peer-deps

# Copy source
COPY apps/leaderboard/ ./

# Build Next.js
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

# Production stage
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --create-home nextjs

# Copy built application
COPY --from=builder --chown=nextjs:nodejs /app/apps/leaderboard/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/leaderboard/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/leaderboard/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/apps/leaderboard/package.json ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/leaderboard/drizzle.config.ts ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/leaderboard/node_modules ./node_modules

USER nextjs

EXPOSE 5012

ENV PORT=5012
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:5012/api/health || exit 1

CMD ["node", "server.js"]
