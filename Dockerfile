FROM oven/bun:1.2.20
WORKDIR /app
COPY . .
ENV PORT=8080
EXPOSE 8080
CMD ["bun", "run", "index.ts"]
