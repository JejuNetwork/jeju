FROM oven/bun:1.1-alpine

WORKDIR /app

COPY package.json ./
RUN bun install --frozen-lockfile

COPY . .

ENV NODE_ENV=production
ENV PORT=4010

EXPOSE 4010

CMD ["bun", "run", "index.ts"]
