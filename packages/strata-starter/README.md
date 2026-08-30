# create-strata

Scaffold a new [Strata](https://github.com/EyK-26/strata) application.

## Usage

```bash
bunx @getstrata/starter my-app
# or after install: bunx create-strata my-app
```

## What you get

- Bun + TypeScript app using `@getstrata/core` and `@getstrata/bootstrap`
- Postgres via Docker Compose (no WorkHub `tenant` table; set `TENANCY_DRIVER=none`)
- Eta templates, simple router, health check
- `strata migrate` / `strata migrate:fresh` and `strata dev` via `@getstrata/cli`

## Environment

Copy `.env.example` to `.env`. The scaffold is an API app without a `tenant` table:

| Variable | Local default | Notes |
|----------|---------------|--------|
| `TENANCY_DRIVER` | `none` | Skip Postgres RLS / `tenant` lookups |
| `FRONTEND_MODE` | `api` | Use `server-htmx` only if you add cookie sessions |
| `SESSION_SECRET` | unset | Required in production when `FRONTEND_MODE=server-htmx` |
| `TRUST_FORWARDED_FOR` | unset | Set `true` only behind a trusted reverse proxy |
| `METRICS_TOKEN` | unset | Required in production to expose `GET /metrics` |
| `FEATURE_PUBLIC_READS` | unset | Set `false` in production |

`createAppContext()` does not call `assertProductionSecrets()`. The helper is feature-gated (API tokens, Stripe, SCIM only when those features are on). Starter apps can call it in production without enabling those features.

## Publish

Released from the strata monorepo on npm as `@getstrata/starter`.
