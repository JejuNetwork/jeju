FROM oven/bun:latest

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile --production

# Copy oracle updater script
COPY scripts/oracle-updater.ts ./scripts/

# Health check
HEALTHCHECK --interval=5m --timeout=10s --start-period=30s --retries=3 \
  CMD bun run -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1))"

# Run as non-root user
USER bun

CMD ["bun", "run", "scripts/oracle-updater.ts"]

