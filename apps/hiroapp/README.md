# hiroapp

This in-repo app is Strata dogfood for internal end-to-end testing (migrate, seed, boot, OpenAPI, smoke). It is not a product. Start a product app with `bunx create-strata`.

## Layers

| Layer | Choice |
|-------|--------|
| Frontend | `server-htmx` |
| Database | `postgres` |
| Auth | `cookie-token-jwt` |
| Tenancy | `rls` |
| Cache | `redis` |
| Queue | `redis` |
| Mail | `smtp` |
| SPA prefix | `/app` |
| Docker Compose | postgres, redis, mailpit, adminer |
| Extras | mfa, emailVerification, scim, metrics |

This file is the map for this app. Framework guides: [Building apps](https://github.com/EyK-26/strata/blob/main/docs/BUILDING-APPS.md), [Auth](https://github.com/EyK-26/strata/blob/main/docs/AUTH.md), [Starter](https://github.com/EyK-26/strata/blob/main/docs/STARTER.md).

## Run it

```bash
cd hiroapp
cp .env.example .env
docker compose up -d
bun install
bun run db:migrate
bun run dev
```

Open http://localhost:3000. Health check: `GET /health`.

## Supporting tools

Docker Compose includes Postgres, Redis, SMTP (Mailpit), Adminer (database UI).

```bash
docker compose up -d
```

Adminer: http://localhost:8080 (PostgreSQL, server `postgres`, username `postgres`, password `postgres`).


Seeded login (password `password`):

- `demo@example.com` (member)
- `admin@example.test` (admin)

HTML auth kit (restyle `views/` and `public/assets/site.css`):

- Welcome: `/`
- Sign in: `/login`
- Register: `/register`
- Forgot password: `/forgot-password`
- Reset password: signed `/reset-password` (mail log when `MAIL_DRIVER=log`)
- Verify email: `/email/verify`
- MFA challenge: `/login/mfa` and setup: `/account/mfa`

Cookie name is `strata_session`. Forms send CSRF as `_token`.

Opaque token login: `POST /api/v1/auth/login` with `{ "email", "password" }`. Register: `POST /api/v1/auth/register`. Forgot/reset: `POST /api/v1/auth/forgot-password` and signed `POST /api/v1/auth/reset-password`. Send `Authorization: Bearer` after login.

JWT mint: `POST /api/auth/token` with email and password. Short-lived. Do not use JWT as an HTML cookie session.

Prometheus scrape: `GET /metrics`. Production requires `Authorization: Bearer <METRICS_TOKEN>`.

## Database

The app uses the database named in `DATABASE_URL` and creates it on first migrate when the connection user may. Set `APP_DATABASE_URL` only when migrations and the app should target a different database than `DATABASE_URL`.

## Deploy

`Dockerfile` builds a production image from the committed `bun.lock` (run `bun install` once and commit the lockfile).

```bash
docker build -t hiroapp .
docker run --rm -p 3000:3000 --env-file .env.production hiroapp
```

Migrations are a deploy step, not a boot step: run `docker run --rm --env-file .env.production hiroapp bun run db:migrate` before the new version takes traffic.
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
- Set `TOKEN_HASH_PEPPER`.
- Set `SCIM_BEARER_TOKEN`.
- Set `METRICS_TOKEN`.

`strata start` does not migrate when `APP_ENV=production`. Run `bun run db:migrate` as a deploy step. `GET /health` answers 503 until the schema exists, so a fresh deploy stays out of rotation until it is migrated.
