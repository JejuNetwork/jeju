# SQLit Adapter - Bun SQLite HTTP API
# Simple HTTP server providing SQLit API using Bun's built-in SQLite

FROM oven/bun:1.1.42-debian

WORKDIR /app

# Copy source files
COPY package.json server.ts ./

# Install dependencies
RUN bun install

# Create data directory
RUN mkdir -p /data/sqlit/databases

# Expose port
EXPOSE 8546

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -sf http://localhost:8546/v1/status || exit 1

# Run server
CMD ["bun", "run", "server.ts"]
