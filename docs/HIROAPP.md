# HiroApp example

`apps/hiroapp` is a **generated** Strata app: Postgres, server-rendered HTMX, cookie + token + JWT auth, Redis, SMTP. It is produced by `bun run generate:example-apps` from the same layer flags as `create-strata`.

The original hiring product (departments, applications, interviews, offers, candidate SPA, MySQL job-board mirror) was removed until it can be rebuilt on this generator without mixing two databases.

Sibling examples in this repo:

| App | Layers |
|-----|--------|
| `apps/hiroapp-hobby` | SQLite, JSON API, header auth |
| `apps/hiroapp-team` | Postgres, HTMX, cookie sessions, Redis |
| `apps/hiroapp` | Postgres, HTMX, cookies + tokens + JWT, Redis, SMTP |

## Run

```bash
bun run hiroapp:fresh
bun run hiroapp:dev
```

Seeded accounts use password `password`: `demo@example.com` (member) and `admin@example.test` (admin). HTML sign-in is `/login`.

Regenerate all three apps:

```bash
bun run generate:example-apps
```

Wizard and flags: [STARTER.md](./STARTER.md).
