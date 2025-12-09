FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun build src/index.ts --outdir=dist --target=bun

FROM oven/bun:1-alpine
WORKDIR /app

# Use existing bun user (uid/gid 1000)
COPY --from=builder --chown=bun:bun /app/dist ./dist
COPY --from=builder --chown=bun:bun /app/package.json ./

# Create data directory
RUN mkdir -p /data/commitments && chown -R bun:bun /data

USER bun

ENV PORT=3100
ENV DATA_DIR=/data
EXPOSE 3100

CMD ["bun", "run", "dist/index.js"]
