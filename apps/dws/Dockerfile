FROM oven/bun:1.1-alpine

WORKDIR /app

# Install deps
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY src/ ./src/
COPY frontend/ ./frontend/
COPY tsconfig.json ./

# Build
RUN bun run build || true

# Expose ports
EXPOSE 4030 4031 4032

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -q -O- http://localhost:4030/health || exit 1

# Run
CMD ["bun", "run", "src/server/index.ts"]



