FROM oven/bun:1.2.20
WORKDIR /app
COPY package.json server.ts index.html site.css site.js favicon.svg ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun","run","server.ts"]
