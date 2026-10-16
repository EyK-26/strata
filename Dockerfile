# Framework acceptance image. Product applications own their deployment images.
FROM oven/bun:1.4.3 AS base
WORKDIR /workspace

FROM base AS install
COPY package.json bun.lock ./
COPY packages/strata-core/package.json packages/strata-core/
COPY packages/strata-bootstrap/package.json packages/strata-bootstrap/
COPY packages/strata-cli/package.json packages/strata-cli/
COPY packages/strata-starter/package.json packages/strata-starter/
COPY packages/create-strata/package.json packages/create-strata/
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile --ignore-scripts

FROM base AS build
COPY --from=install /workspace/node_modules ./node_modules
COPY . .
RUN bun run build:framework && bun run build:bootstrap
RUN bun scripts/build-docker-acceptance.ts /opt/strata-acceptance

FROM oven/bun:1.4.3 AS release
WORKDIR /app
COPY --from=build --chown=bun:bun /opt/strata-acceptance/ ./
ENV NODE_ENV=production
USER bun
EXPOSE 3000
HEALTHCHECK --interval=2s --timeout=5s --start-period=10s --retries=15 \
  CMD bun -e "fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["bun", "node_modules/@getstrata/cli/cli.ts", "start"]
