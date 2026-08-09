FROM oven/bun:1.3.14 AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock ./
COPY packages/strata-core/package.json packages/strata-core/
COPY packages/strata-bootstrap/package.json packages/strata-bootstrap/
COPY packages/strata-cli/package.json packages/strata-cli/
COPY packages/strata-starter/package.json packages/strata-starter/
RUN bun install --frozen-lockfile

FROM base AS release
COPY --from=install /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
USER bun
EXPOSE 3000
CMD ["bun", "run", "start"]
