# Production image. Build once, run with env from your platform; see README "Deploy".
FROM oven/bun:1.4 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4-slim AS runtime
WORKDIR /app
ENV APP_ENV=production
ENV AUTH_DEV_HEADERS=false
ENV PORT=3000
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p storage && chown -R bun:bun /app
USER bun
EXPOSE 3000
# SQLite lives in storage/; mount a volume there or the data dies with the container.
VOLUME ["/app/storage"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD ["bun", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["bun", "run", "start"]
