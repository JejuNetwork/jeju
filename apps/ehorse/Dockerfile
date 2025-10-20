# eHorse TEE Container
# Runs horse racing game in Trusted Execution Environment
# Built for Phala Cloud CVMs with Dstack

FROM oven/bun:1.1-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy application code
COPY . .

# Create data directory
RUN mkdir -p /app/data && chmod 755 /app/data

# Set environment variables
ENV NODE_ENV=production
ENV EHORSE_PORT=5700
ENV DSTACK_SOCKET_PATH=/var/run/dstack.sock

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:5700/health || exit 1

# Expose port
EXPOSE 5700

# Run as non-root user (gem, like VibeVM)
RUN groupadd --gid 1000 gem && \
    useradd --uid 1000 --gid 1000 --create-home gem && \
    chown -R gem:gem /app

USER gem

# Start eHorse TEE service
CMD ["bun", "run", "src/index.ts"]

