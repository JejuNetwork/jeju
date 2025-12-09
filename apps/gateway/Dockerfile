# Gateway Portal - Protocol Infrastructure Hub
# Build from monorepo root to include workspace packages

FROM oven/bun:1.1-slim AS base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace package files
FROM base AS deps

# Copy root package.json and bun.lock
COPY package.json bun.lock* ./

# Copy all package.json files for workspace resolution
COPY packages/types/package.json ./packages/types/
COPY packages/config/package.json ./packages/config/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/tests/package.json ./packages/tests/
COPY apps/gateway/package.json ./apps/gateway/

# Install all dependencies
RUN bun install --frozen-lockfile || bun install

# Build stage
FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/types/node_modules ./packages/types/node_modules
COPY --from=deps /app/packages/config/node_modules ./packages/config/node_modules
COPY --from=deps /app/packages/contracts/node_modules ./packages/contracts/node_modules

# Copy source code
COPY packages/types ./packages/types
COPY packages/config ./packages/config  
COPY packages/contracts ./packages/contracts
COPY apps/gateway ./apps/gateway

# Build packages first
WORKDIR /app/packages/types
RUN bun run build || echo "No build script"

WORKDIR /app/packages/config
RUN bun run build || echo "No build script"

WORKDIR /app/packages/contracts
RUN bun run build || echo "No build script"

# Build gateway
WORKDIR /app/apps/gateway
ENV NODE_ENV=production
RUN bun run build

# Production stage - serve with nginx
FROM nginx:alpine AS runner

# Copy nginx configuration
COPY <<'EOF' /etc/nginx/conf.d/default.conf
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }
}
EOF

# Copy built assets
COPY --from=builder /app/apps/gateway/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
