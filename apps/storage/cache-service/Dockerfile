FROM oven/bun:1.1-alpine

WORKDIR /app

COPY package.json ./
RUN bun install --frozen-lockfile

COPY . .

ENV NODE_ENV=production
ENV CACHE_SERVICE_PORT=4015

EXPOSE 4015

CMD ["bun", "run", "index.ts"]
