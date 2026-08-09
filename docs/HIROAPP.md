# HiroApp example

`apps/hiroapp` is a **generated** Strata app: Postgres, server-rendered HTMX, cookie + token + JWT auth, Redis, SMTP, Postgres RLS, and extras (MFA, email verification, SCIM, metrics). It is produced by `bun run generate:example-apps` from the same layer flags as `create-strata`.

Sibling examples in this repo:

| App | Layers |
|-----|--------|
| `apps/hiroapp-hobby` | SQLite, JSON API, header auth, tenancy none |
| `apps/hiroapp-team` | Postgres, HTMX, cookie sessions, Redis, metrics, Adminer |
| `apps/hiroapp` | Postgres, HTMX, cookies + tokens + JWT, RLS, Redis, SMTP, extras MFA / email verification / SCIM / metrics, Adminer |

Cookie HTML apps include a restyleable welcome page, login, register, and password reset (`views/` and `public/assets/site.css`). HiroApp extras wire MFA pages, `/email/verify`, `/scim/v2/Users`, and `GET /metrics`. Apps that leave the metrics extra off do not get that route.

HTML cookie name is `strata_session`. Redis keys use `APP_KEY_PREFIX=hiroapp`. Seeded accounts use password `password`: `demo@example.com` (member) and `admin@example.test` (admin). HTML sign-in is `/login`.

## Run

```bash
bun run hiroapp:fresh
bun run hiroapp:dev
```

Regenerate all three apps:

```bash
bun run generate:example-apps
```

Wizard and flags: [STARTER.md](./STARTER.md).
