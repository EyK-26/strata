# Getting started

This guide is for running **this repository** (framework source plus generated examples). To start a product app, use [STARTER.md](./STARTER.md): `bunx create-strata my-app`.

This guide assumes you can run a terminal, Docker, and Bun.

## 1. Install tools

- [Bun](https://bun.sh) 1.4.x (latest 1.4 patch; CI reads `.bun-version`)
- Docker Compose (for PostgreSQL 18 and Redis)

Clone the repo and install JavaScript packages:

```bash
bun install
```

## 2. Environment files

For Docker Compose (app in a container):

```bash
cp .env.example .env
```

For Bun on your machine, with Postgres and Redis in Docker on published ports:

```bash
cp .env.host.example .env.host
```

`bun run dev:host` and `bun run validate:host` load the host file for you.

The in-repo HTML example (`apps/hiroapp`) should use:

```bash
APP_NAME=hiroapp
APP_KEY_PREFIX=hiroapp
API_PREFIX=/api
FRONTEND_MODE=server-htmx
AUTH_DEV_HEADERS=false
```

`APP_KEY_PREFIX` names Redis keys (`hiroapp:queue:default`). Generated HTML apps use cookie `strata_session` unless you change `cookieName` in the auth provider. If you run two apps against one Redis, they must not share a prefix.

## 3. Start Postgres and Redis

```bash
docker compose up -d postgres redis --wait
```

Default host ports: Postgres `54329`, Redis `6379`. HiroApp migrate creates `hiroapp_test` on that Postgres server so it does not share tables with the framework fixture database.

## 4. Build the framework packages

Apps import `@getstrata/core/*` from `packages/strata-core/dist`. Build before migrate:

```bash
bun run build:framework
bun run build:bootstrap
```

## 5. Create the example database

```bash
bun run hiroapp:fresh
```

This creates `hiroapp_test` if needed, runs the generated starter schema, and seeds people you can log in as.

## 6. Start the app

```bash
bun run hiroapp:dev
```

Visit http://localhost:3000. HTML sign-in is `/login`.

| Email | Password | Role |
|-------|----------|------|
| `demo@example.com` | `password` | member |
| `admin@example.test` | `password` | admin |

## 7. Try the generated paths

1. **HTML browser (cookie + CSRF).** Open `/login`, sign in as `demo@example.com`. HTML forms post `_token`.
2. **Health.** `GET /health` returns `ok` when the database answers.
3. **API token or JWT.** `POST /api/v1/auth/login` mints an opaque token. `POST /api/auth/token` mints a short-lived JWT. Call `GET /api/user` with `Authorization: Bearer <token>`. Details: [AUTH.md](./AUTH.md).

Your own app should be generated with `bunx create-strata`, not copied from HiroApp. See [STARTER.md](./STARTER.md).

## 8. When something fails

| Symptom | Likely cause |
|---------|----------------|
| HiroApp migrate cannot import `@getstrata/core/...` | Run `bun run build:framework` |
| Cookie login loops | `SESSION_SECRET` missing, or the browser is sending a different cookie name than `strata_session` |
| 403 on POST | Missing CSRF token (`_token` or `x-csrf-token`) |
| 403 on Bearer POST | Token missing the ability, or you sent CSRF-protected cookie API without a token |
| Tests reset the wrong database | `DATABASE_URL` is not a test URL. See [TESTING.md](./TESTING.md) |

Next: [HIROAPP.md](./HIROAPP.md) for the three example apps, or [BUILDING-APPS.md](./BUILDING-APPS.md) to start your own app.
