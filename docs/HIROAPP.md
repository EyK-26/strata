# HiroApp dogfood

`apps/hiroapp` is a retained legacy compatibility fixture pending staged removal. CI now runs security, OpenAPI and HTTP smoke acceptance on disposable generated apps. Legacy CLI/migration loaders and Docker/workspace wiring still use this directory until their removal is qualified. It is generated from the same layer flags as `create-strata`, not a product starter. Start a product app with `bunx create-strata`.

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

## Transition to generated acceptance fixtures

The 23-case security suite now runs against a freshly generated temporary app with packed candidate runtime packages, not this directory. CI/release validation runs it through `validate:ci`. Checked-in HiroApp still supplies boot, OpenAPI and smoke fixtures until their replacements pass. See [the staged removal gates](GENERATED-APP-ACCEPTANCE.md); the apps are deliberately retained during this first step.

Generated CLI/OpenAPI/HTTP smoke acceptance has now replaced the fixed-port checked-in server in CI. The existing runtime inventory is preserved separately from the corrected API-only spec. Legacy CLI/migration loaders and Docker/workspace wiring remain until the final removal PR; see [second-stage evidence](GENERATED-APP-ACCEPTANCE.md#second-pr-generated-cliopenapi-and-http-smoke).
