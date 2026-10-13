FROM oven/bun:1.2.20
WORKDIR /app
COPY . .
RUN bun run build-bridge.ts && bun run feature-stop.ts && bun run gantt-details.ts && bun build ./index.ts --target=bun --outdir=/tmp/pp-check
ENV PORT=8080
EXPOSE 8080
CMD ["bun", "run", "index.ts"]
