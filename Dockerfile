# check=skip=SecretsUsedInArgOrEnv
# APP_KEY_PREFIX namespaces cookies and Redis keys. It is not a secret, but the
# linter matches any ENV whose name contains KEY.
FROM oven/bun:1.4 AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock ./
COPY packages/strata-core/package.json packages/strata-core/
COPY packages/strata-bootstrap/package.json packages/strata-bootstrap/
COPY packages/strata-cli/package.json packages/strata-cli/
COPY packages/strata-starter/package.json packages/strata-starter/
COPY apps/hiroapp/package.json apps/hiroapp/
COPY apps/hiroapp-hobby/package.json apps/hiroapp-hobby/
COPY apps/hiroapp-team/package.json apps/hiroapp-team/
RUN bun install --frozen-lockfile

FROM base AS build
COPY --from=install /app/node_modules ./node_modules
COPY . .
RUN bun run build:framework && bun run build:bootstrap
# Drop devDependencies once the framework is built. This needs bun.lock to agree
# with every package.json, which `bun run bump` keeps in sync.
RUN bun prune --production
ENV NODE_ENV=production

FROM base AS release
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/bun.lock ./bun.lock
COPY --from=build /app/packages ./packages
COPY --from=build /app/src ./src
COPY --from=build /app/apps ./apps
COPY --from=build /app/bunfig.toml ./bunfig.toml
ENV NODE_ENV=production
ENV DOGFOOD_APP=hiroapp
ENV APP_KEY_PREFIX=hiroapp
ENV APP_NAME=HiroApp
ENV API_PREFIX=/api
USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
# The install stage links bins from package.json alone, before the workspace
# sources are copied, so node_modules/.bin/strata is never created. Invoke the
# CLI directly instead of going through `bun run start`.
CMD ["bun", "packages/strata-cli/cli.ts", "start"]
