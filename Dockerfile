FROM oven/bun:1.4.1 AS base
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
# bun prune --production fails on this workspace ("bun.lock does not match
# package.json") in Bun 1.4. The image runs TypeScript from source.
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
CMD ["bun", "run", "start"]
