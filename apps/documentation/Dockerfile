# Documentation - VitePress Static Site
# Build static docs and serve with nginx
# NOTE: Build context must be project root for config access

FROM oven/bun:latest AS builder

# Install system dependencies including build tools
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy config first (needed for builds)
COPY config ./config

# Install dependencies
COPY apps/documentation/package.json apps/documentation/bun.lock* ./
RUN bun install 

# Copy source
COPY apps/documentation .

# Build VitePress static site
ENV NODE_ENV=production
RUN bun run build

# Production - nginx
FROM nginx:alpine AS runner

# Copy nginx config
COPY <<'EOF' /etc/nginx/conf.d/default.conf
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # Enable gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

    # VitePress routing
    location / {
        try_files $uri $uri/ $uri.html =404;
    }

    # Assets caching
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Health check
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }
}
EOF

# Copy built site
COPY --from=builder /app/.vitepress/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]

