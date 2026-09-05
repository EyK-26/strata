# HiroApp example

`apps/hiroapp` is a **generated** Strata app: Postgres, server-rendered HTMX, cookie + token + JWT auth, Redis, SMTP, Postgres RLS env, and extras flags. It is produced by `bun run generate:example-apps` from the same layer flags as `create-strata`.

The original hiring product (departments, applications, interviews, offers, candidate SPA, MySQL job-board mirror) was removed until it can be rebuilt on this generator without mixing two databases. Other guides describe this generated app, not that old product.

Sibling examples in this repo:

| App | Layers |
|-----|--------|
| `apps/hiroapp-hobby` | SQLite, JSON API, header auth, tenancy none |
| `apps/hiroapp-team` | Postgres, HTMX, cookie sessions, Redis, metrics |
| `apps/hiroapp` | Postgres, HTMX, cookies + tokens + JWT, RLS, Redis, SMTP, extras MFA / email verification / SCIM / metrics |

Extras on `apps/hiroapp` are env stubs (`FEATURE_MFA`, `FEATURE_EMAIL_VERIFICATION`, `FEATURE_SCIM`, `METRICS_TOKEN`). Metrics routes are wired. MFA enrollment, `/email/verify`, and SCIM adapters are yours to add.

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
