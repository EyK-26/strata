# HiroApp

In-repo dogfood app for Strata. One domain, two skins:

- `FRONTEND_MODE=spa-react` — React SPA (`frontend/`)
- `FRONTEND_MODE=server-htmx` — HTMX + Eta (`resources/views/`)

`bun run dev` starts HiroApp (Wave 5). WorkHub stays the Jetstream / SCIM / RLS dogfood (`bun run workhub:dev`) and the CI coverage gate. HiroApp uses an isolated Postgres database (`hiroapp_test`) so the two schemas never share a `users` table. See [docs/DOGFOOD.md](../../docs/DOGFOOD.md).

## Run

```bash
bun run hiroapp:fresh
bun run dev
# or
bun run hiroapp:dev:htmx
```

Seeded logins (password is `password`):

- `admin@hiroapp.com`
- `candidate@hiroapp.com`
- `recruiter@hiroapp.com`

## Tests

```bash
bun run test:hiroapp
```

HiroApp tests run after WorkHub `test:coverage` in `validate:ci`. They do not enter the WorkHub 100% coverage gate.

## Layout

- `src/models` — Laravel-shaped Eloquent models (`hasManyThrough`, morph comments, soft deletes)
- `src/modules` — HTTP APIs, policies, FormRequests, HTMX pages
- `src/db` — migrations, factories, seeders
- `frontend` — React SPA
- `resources/views` — Eta templates
- `public` — HTMX static assets (`/assets/app.css`), served from this app directory even when the process starts at the monorepo root
