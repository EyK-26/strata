# hiroapp-hobby

This in-repo app is a generated sibling layer map. It is not a product and it is not CI dogfood. CI dogfood is `apps/hiroapp`. Start a product app with `bunx create-strata`.

## Layers

| Layer | Choice |
|-------|--------|
| Frontend | `api` |
| Database | `sqlite` |
| Auth | `headers` |
| Tenancy | `none` |
| Cache | `array` |
| Queue | `sync` |
| Mail | `log` |
| SPA prefix | `/app` |
| Docker Compose | not needed |

This file is the map for this app. Framework guides: [Building apps](https://github.com/EyK-26/strata/blob/main/docs/BUILDING-APPS.md), [Auth](https://github.com/EyK-26/strata/blob/main/docs/AUTH.md), [Starter](https://github.com/EyK-26/strata/blob/main/docs/STARTER.md), [Integrations](https://github.com/EyK-26/strata/blob/main/docs/INTEGRATIONS.md).

## Integrations

OAuth, billing, outbound webhooks, SIEM, and SAML are **off by default**. Commented placeholders live in `.env.example`. Framework map: [INTEGRATIONS.md](https://github.com/EyK-26/strata/blob/main/docs/INTEGRATIONS.md).

Wizard flags (any stack unless noted): `--oauth-github` and `--oidc` (cookie HTML), `--billing`, `--webhooks`. They emit modules, migrations, jobs, or listeners. `createApp` still calls `await discoverListeners()` and `await discoverJobs()`.

This app did not pass those flags. Turn a flag on and re-run `create-strata`, or copy the commented env block and add a module yourself.


## Run it

```bash
cd hiroapp-hobby
cp .env.example .env
bun install
bun run db:migrate
bun run db:seed:demo
bun run dev
```

Open http://localhost:3000. Health check: `GET /health`. Redis worker: `bun run queue:work` (requires `REDIS_URL`).


Header auth is on for local use. Send `x-authenticated-user-id` (and optional `x-authenticated-user-role`). Production must set `AUTH_DEV_HEADERS=false`.

## OpenAPI

After you add routes, regenerate and commit the spec so CI can catch drift:

```bash
bunx strata openapi:generate
bunx strata openapi:check
```

Put `openapi:check` in CI. A failure means `docs/openapi.json` does not match the live JSON API route map (billing, auth, webhooks, and anything else you added).

`openapi:generate` lists API routes only. HTML admin and storefront paths are not in that file.

## Deploy

`Dockerfile` builds a production image from the committed `bun.lock` (run `bun install` once and commit the lockfile).

```bash
docker build -t hiroapp-hobby .
docker run --rm -p 3000:3000 --env-file .env.production hiroapp-hobby
```

Migrations are a deploy step, not a boot step: run `docker run --rm --env-file .env.production hiroapp-hobby bun run db:migrate` before the new version takes traffic. Migrations and resets do not seed by default. Demo seeding is an explicit development command, `bun run db:seed:demo`, and refuses production/staging. Existing demo accounts must be disabled or have their credentials and sessions/tokens rotated before deployment. SQLite stores its file in `/app/storage`; mount a volume there (`-v strata_data:/app/storage`) or the data is lost with the container.
The image sets `APP_ENV=production` and `AUTH_DEV_HEADERS=false`; everything else in the Production list below comes from your environment (the `.env.production` file above is one way).

## Production

`createApp` calls `assertProductionSecrets()` when `APP_ENV=production`. That check fails closed, so read this before your first production boot.

- Replace every `change-me` placeholder in `.env`. The guard rejects the values this generator wrote, not just empty ones.
- Set `APP_URL` to the public origin (for example `https://app.example.com`). Signed links and redirects are built from it; localhost is rejected.
- Set `AUTH_DEV_HEADERS=false`.
- Set `FEATURE_PUBLIC_READS=false`. Generated `.env.example` already ships `false` so `wrapWebPublicRead` requires a login. Local storefronts may set `true` in `.env` for an anonymous catalog; `assertProductionSecrets()` rejects `true` in production. Do not ship a public-reads production boot.
- Cross-origin browser calls are off in production until you set `CORS_ALLOWED_ORIGINS` to explicit origins. A `*` entry is rejected. Non-browser clients are unaffected.
- Behind a reverse proxy or load balancer, set `TRUST_FORWARDED_FOR=true` so throttles and session records see the client address instead of the proxy. Only the rightmost public hop of `X-Forwarded-For` is trusted.

`strata start` does not migrate when `APP_ENV=production`. Run `bun run db:migrate` as a deploy step. `GET /health` is 200 when `notes` is readable (including zero rows) and 503 when that read fails. Redis jobs need a worker: `bun run queue:work` (requires `REDIS_URL`).
