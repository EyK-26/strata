# HiroApp dogfood

`apps/hiroapp` is Strata dogfood for internal end-to-end testing. CI migrates, seeds, boots, generates OpenAPI, and smokes this app. It is generated from the same layer flags as `create-strata`. It is not a product. Start a product app with `bunx create-strata`.

Sibling apps in this repo are generated layer maps. They are not CI dogfood.

| App | Layers | Role |
|-----|--------|------|
| `apps/hiroapp` | Postgres, HTMX, cookies + tokens + JWT, RLS, Redis, SMTP, extras MFA / email verification / SCIM / metrics, Adminer | Dogfood for internal end-to-end testing |
| `apps/hiroapp-hobby` | SQLite, JSON API, header auth, tenancy none | Sibling layer map (not CI dogfood) |
| `apps/hiroapp-team` | Postgres, HTMX, cookie sessions, Redis, metrics, Adminer | Sibling layer map (not CI dogfood) |

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
