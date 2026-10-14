FROM oven/bun:1.2.20
WORKDIR /app
COPY package.json ./
RUN bun install --production
COPY audit.ts ./
CMD ["bun","run","audit.ts"]
