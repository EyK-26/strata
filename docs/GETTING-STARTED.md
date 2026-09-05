# Getting started

This guide assumes you can run a terminal, Docker, and Bun. You do not need to know this repo yet.

## 1. Install tools

- [Bun](https://bun.sh) 1.4 or newer
- Docker Compose (for PostgreSQL 18, Redis, and optional MySQL)

Clone the repo and install JavaScript packages:

```bash
bun install
```

## 2. Environment files

For Docker Compose (app in a container):

```bash
cp .env.example .env
```

For Bun on your machine, with Postgres/Redis/MySQL in Docker on published ports:

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

`FRONTEND_MODE=hybrid` also serves the candidate SPA at `/apply` (build it with `bun run --cwd apps/hiroapp frontend:build`). Staff HTML stays at `/`.

`APP_KEY_PREFIX` names cookies and Redis keys (`hiroapp_session`, `hiroapp:queue:default`). If you run two apps against one Redis, they must not share a prefix.

## 3. Start Postgres, Redis, and MySQL

```bash
docker compose up -d postgres redis mysql --wait
```

Default host ports: Postgres `54329`, Redis `6379`, MySQL `33061`. MySQL is the job-board mirror only. Hiring still runs if you skip it.

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

Or staff HTML plus the candidate portal:

```bash
bun run hiroapp:dev:hybrid
```

Visit http://localhost:3000.

| Email | Password | What they can do |
|-------|----------|------------------|
| `admin@hiroapp.com` | `password` | Entire hiring OS, audit export, SCIM staff |
| `recruiter@hiroapp.com` | `password` | Pipeline for their department |
| `candidate@hiroapp.com` | `password` | Apply, interviews, offers, profile |

## 7. Try four real paths

1. **Staff browser (cookie + CSRF).** Open `/login`, sign in as the recruiter. HTML forms post `_token`.
2. **Candidate portal.** Open `/apply`, sign in as the candidate. Login mints a hashed opaque token. The SPA stores it in `sessionStorage` (a memory store plus a refresh cookie is stronger for production).
3. **Public careers.** Open `/careers` without logging in. Listed postings are public.
4. **API token or JWT.** As a recruiter, create a token on `/account` or `POST /api/auth/tokens`. Call `GET /api/user` with `Authorization: Bearer <token>`. Or mint a short-lived JWT with `POST /api/auth/token`. Staff JWTs do not include `*`. Partner ping still needs an opaque token with `integrations:ping`. Details: [AUTH.md](./AUTH.md).

## 8. When something fails

| Symptom | Likely cause |
|---------|----------------|
| HiroApp migrate cannot import `@getstrata/core/...` | Run `bun run build:framework` |
| Cookie login loops | `SESSION_SECRET` missing, or you are mixing `APP_KEY_PREFIX` values |
| 403 on POST | Missing CSRF token (`_token` or `x-csrf-token`) |
| 403 on Bearer POST | Token missing the ability, or you sent CSRF-protected cookie API without a token |
| `/apply` returns 503 | Run `bun run --cwd apps/hiroapp frontend:build` |
| Tests reset the wrong database | `DATABASE_URL` is not a test URL. See [TESTING.md](./TESTING.md) |

Next: [HIROAPP.md](./HIROAPP.md) to learn the product, or [BUILDING-APPS.md](./BUILDING-APPS.md) to start your own app.
