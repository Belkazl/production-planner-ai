FROM oven/bun:1.2.20
WORKDIR /app
COPY package.json server.ts growth.mjs index.html site.css site.js favicon.svg robots.txt sitemap.xml llms.txt 65dead239d02c66083c4a583bb7b69c432fb9582.txt ./
COPY assets ./assets
ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun","run","server.ts"]
