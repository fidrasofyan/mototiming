FROM oven/bun:1.4.4-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY bunfig.toml ./
COPY src ./src

EXPOSE 3000

CMD ["bun", "run", "start"]
