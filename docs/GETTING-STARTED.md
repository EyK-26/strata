# Getting started

This guide assumes you can run a terminal, Docker, and Bun. You do not need to know this repo yet.

## 1. Install tools

- [Bun](https://bun.sh) 1.4 or newer
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

For Bun on your machine, with Postgres/Redis in Docker on published ports:

```bash
cp .env.host.example .env.host
```

`bun run dev:host` and `bun run validate:host` load the host file for you.

HiroApp should use:

```bash
APP_NAME=HiroApp
APP_KEY_PREFIX=hiroapp
API_PREFIX=/api
FRONTEND_MODE=server-htmx
AUTH_DEV_HEADERS=false
```

`APP_KEY_PREFIX` names cookies and Redis keys (`hiroapp_session`, `hiroapp:queue:default`). If you run two apps against one Redis, they must not share a prefix.

## 3. Start Postgres and Redis

```bash
docker compose up -d postgres redis --wait
```

Default host ports: Postgres `54329`, Redis `6379`.

## 4. Build the framework packages

HiroApp imports `@getstrata/core/*` from `packages/strata-core/dist`. Build before migrate:

```bash
bun run build:framework
bun run build:bootstrap
```

## 5. Create the HiroApp database

```bash
bun run hiroapp:fresh
```

This creates `hiroapp_test` if needed, runs HiroApp migrations, and seeds people you can log in as.

## 6. Start the app

```bash
bun run hiroapp:dev:htmx
```

Visit http://localhost:3000.

| Email | Password | What they can do |
|-------|----------|------------------|
| `admin@hiroapp.com` | `password` | Entire hiring OS, audit export, SCIM staff |
| `recruiter@hiroapp.com` | `password` | Pipeline for their department |
| `candidate@hiroapp.com` | `password` | Apply, interviews, offers, profile |

## 7. Try three real paths

1. **Browser (cookie + CSRF).** Open `/login`, sign in as the candidate, apply to a listed job. HTML forms post `_token`. The server checks CSRF, then the cookie session.
2. **Public careers.** Open `/careers` without logging in. Listed postings are public. Applying still requires a candidate session.
3. **API token or JWT.** As a recruiter, create a token on `/account` or `POST /api/auth/tokens`. Call `GET /api/user` with `Authorization: Bearer <token>`. Or mint a short-lived JWT with `POST /api/auth/token` (email + password, no CSRF). Details: [AUTH.md](./AUTH.md).

## 8. When something fails

| Symptom | Likely cause |
|---------|----------------|
| HiroApp migrate cannot import `@getstrata/core/...` | Run `bun run build:framework` |
| Cookie login loops | `SESSION_SECRET` missing, or you are mixing `APP_KEY_PREFIX` values |
| 403 on POST | Missing CSRF token (`_token` or `x-csrf-token`) |
| 403 on Bearer POST | Token missing the ability, or you sent CSRF-protected cookie API without a token |
| Tests reset the wrong database | `DATABASE_URL` is not a test URL. See [TESTING.md](./TESTING.md) |

Next: [HIROAPP.md](./HIROAPP.md) to learn the product, or [BUILDING-APPS.md](./BUILDING-APPS.md) to start your own app.
