FROM oven/bun:1-debian AS base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    ca-certificates \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node.js (ElizaOS needs Node for some packages)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json bun.lockb* ./
COPY packages/plugin-crucible/package.json ./packages/plugin-crucible/

# Install dependencies
RUN bun install --frozen-lockfile || bun install

# Copy source code
COPY src ./src
COPY characters ./characters
COPY packages ./packages
COPY ui ./ui

# Build plugin package
RUN cd packages/plugin-crucible && bun run build

# Environment defaults
ENV NODE_ENV=production
ENV SERVER_PORT=7777
ENV NETWORK=localnet
ENV LOG_LEVEL=info

# Expose ports
EXPOSE 7777 5010

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:7777/api/server/health || exit 1

# Start server
CMD ["bun", "run", "src/index.ts"]

