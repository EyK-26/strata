# hiroapp-team

This in-repo app is a generated sibling layer map. It is not a product and it is not CI dogfood. CI dogfood is `apps/hiroapp`. Start a product app with `bunx create-strata`.

## Layers

| Layer | Choice |
|-------|--------|
| Frontend | `server-htmx` |
| Database | `postgres` |
| Auth | `cookie` |
| Tenancy | `none` |
| Cache | `redis` |
| Queue | `redis` |
| Mail | `log` |
| SPA prefix | `/app` |
| Docker Compose | postgres, redis |
| Extras | metrics |

This file is the map for this app. Framework guides: [Building apps](https://github.com/EyK-26/strata/blob/main/docs/BUILDING-APPS.md), [Auth](https://github.com/EyK-26/strata/blob/main/docs/AUTH.md), [Starter](https://github.com/EyK-26/strata/blob/main/docs/STARTER.md).

## Run it

```bash
cd hiroapp-team
cp .env.example .env
docker compose up -d
bun install
bun run db:migrate
bun run dev
```

Open http://localhost:3000. Health check: `GET /health`.

## Supporting tools

Docker Compose includes Postgres, Redis.

```bash
docker compose up -d
```


Seeded login (password `StrataDemo!ChangeMe`):

- `demo@example.com` (member)
- `admin@example.test` (admin)

HTML auth kit (restyle `views/` and `public/assets/site.css`):

- Welcome: `/`
- Sign in: `/login`
- Register: `/register`
- Forgot password: `/forgot-password`
- Reset password: signed `/reset-password` (mail log when `MAIL_DRIVER=log`)

Cookie name is `strata_session`. Forms send CSRF as `_token`.

Prometheus scrape: `GET /metrics`. Production requires `Authorization: Bearer <METRICS_TOKEN>`.

## Database

The app uses the database named in `DATABASE_URL` and creates it on first migrate when the connection user may. Set `APP_DATABASE_URL` only when migrations and the app should target a different database than `DATABASE_URL`. Compose creates `strata_app` (`NOSUPERUSER` `NOBYPASSRLS`) on first empty volume and `.env.example` points `DATABASE_URL` at that role. The `postgres` superuser is for volume init and Adminer.

## Deploy

`Dockerfile` builds a production image from the committed `bun.lock` (run `bun install` once and commit the lockfile).

```bash
docker build -t hiroapp-team .
docker run --rm -p 3000:3000 --env-file .env.production hiroapp-team
```

Migrations are a deploy step, not a boot step: run `docker run --rm --env-file .env.production hiroapp-team bun run db:migrate` before the new version takes traffic.
The image sets `APP_ENV=production` and `AUTH_DEV_HEADERS=false`; everything else in the Production list below comes from your environment (the `.env.production` file above is one way).

## Production

`createApp` calls `assertProductionSecrets()` when `APP_ENV=production`. That check fails closed, so read this before your first production boot.

- Replace every `change-me` placeholder in `.env`. The guard rejects the values this generator wrote, not just empty ones.
- Set `APP_URL` to the public origin (for example `https://app.example.com`). Signed links and redirects are built from it; localhost is rejected.
- Set `AUTH_DEV_HEADERS=false`.
- Set `FEATURE_PUBLIC_READS=false`. This app ships `true` so the local welcome page reads without a login. Production requires `false`.
- Cross-origin browser calls are off in production until you set `CORS_ALLOWED_ORIGINS` to explicit origins. A `*` entry is rejected. Non-browser clients are unaffected.
- Behind a reverse proxy or load balancer, set `TRUST_FORWARDED_FOR=true` so throttles and session records see the client address instead of the proxy. Only the rightmost public hop of `X-Forwarded-For` is trusted.
- Set `SESSION_SECRET` to 32+ characters.
- Set `METRICS_TOKEN`.

`strata start` does not migrate when `APP_ENV=production`. Run `bun run db:migrate` as a deploy step. `GET /health` answers 503 until a notes row is readable, so a fresh deploy stays out of rotation until it is migrated.
