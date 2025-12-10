# Monitoring Dashboard - Vite React App + Express A2A Server
# Production build for AWS ECS/EKS

FROM oven/bun:1.1-slim AS base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

# Build stage
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build Vite app
ENV NODE_ENV=production
RUN bun run build

# Production stage
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

# Create non-root user
RUN groupadd --gid 1001 monitor && \
    useradd --uid 1001 --gid monitor --create-home monitor

# Copy built application
COPY --from=builder --chown=monitor:monitor /app/dist ./dist
COPY --from=builder --chown=monitor:monitor /app/server ./server
COPY --from=builder --chown=monitor:monitor /app/package.json ./
COPY --from=builder --chown=monitor:monitor /app/node_modules ./node_modules

# Copy Grafana/Prometheus configs
COPY --from=builder --chown=monitor:monitor /app/grafana ./grafana
COPY --from=builder --chown=monitor:monitor /app/prometheus ./prometheus

USER monitor

EXPOSE 4020

ENV PORT=4020
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:4020/health || exit 1

# Run A2A server which also serves static files
CMD ["bun", "run", "server/a2a.ts"]

