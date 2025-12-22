FROM oven/bun:1.1-alpine
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production
COPY src/ ./src/
COPY tsconfig.json ./
EXPOSE 4016
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -q -O- http://localhost:4016/health || exit 1
CMD ["bun", "run", "src/triggers/index.ts"]
