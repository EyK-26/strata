# HiroApp dogfood

`apps/hiroapp` is Strata dogfood for internal end-to-end testing. CI migrates, seeds, boots, generates OpenAPI, and smokes this app. It is generated from the same layer flags as `create-strata`. It is not a product. Start a product app with `bunx create-strata`.

CI also runs **integration extras HTTP smoke** (`scripts/smoke-integrations.ts`, included in `bun run smoke`). That script scaffolds a temporary app with `--oauth-github`, `--oidc`, `--billing`, and `--webhooks`. It is not HiroApp. It checks the GitHub authorize redirect, the OIDC redirect against a loopback discovery document, and that `/auth/oidc/callback` presents the `oidc_pkce` cookie with the authorize `state` and returns 400 when token exchange fails. It also posts a signed Stripe webhook. It does not finish a GitHub or OIDC login, deliver an outbound webhook, or sync a subscription plan.

`scripts/smoke-spa.ts` (also in `bun run smoke`) scaffolds a temporary **hybrid** app, runs `frontend:build`, and fetches `/app`. That response is the built SPA document, not the 503 that means `frontend/dist` is missing. The HiroApp preset stays `server-htmx`.

The HiroApp preset leaves those extras off, so HiroApp itself does not exercise outbound webhooks, Stripe plan sync, or GitHub/OIDC cookie login. Product dogfood for the full paths is external (`strata-shop`).

Sibling apps in this repo are generated layer maps. They are not CI dogfood.

| App | Layers | Role |
|-----|--------|------|
| `apps/hiroapp` | Postgres, HTMX, cookies + tokens + JWT, RLS on notes, Redis, SMTP, extras MFA / email verification / SCIM / metrics (no Adminer) | Dogfood for internal end-to-end testing |
| `apps/hiroapp-hobby` | SQLite, JSON API, header auth, tenancy none | Sibling layer map (not CI dogfood) |
| `apps/hiroapp-team` | Postgres, HTMX, cookie sessions, Redis, metrics, Adminer | Sibling layer map (not CI dogfood) |

Cookie HTML apps include a restyleable welcome page, login, register, and password reset (`views/` and `public/assets/site.css`). HiroApp extras wire MFA pages, `/email/verify`, `/scim/v2/Users`, and `GET /metrics`. Apps that leave the metrics extra off do not get that route.

HTML cookie name is `strata_session`. Redis keys use `APP_KEY_PREFIX=hiroapp`. Seeded accounts use password `StrataDemo!ChangeMe`: `demo@example.com` (member) and `admin@example.test` (admin). HTML sign-in is `/login`.

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
