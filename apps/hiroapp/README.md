# HiroApp

Hiring OS used as the Strata example product. Staff HTML uses Eta templates and HTMX. Candidates can use the React portal at `/apply` when `FRONTEND_MODE=hybrid`. JSON lives under `/api`.

`bun run dev` starts this app. Isolated Postgres database: `hiroapp_test`. Guide: [docs/HIROAPP.md](../../docs/HIROAPP.md).

## Run

```bash
bun run hiroapp:fresh
bun run hiroapp:dev:htmx
bun run hiroapp:dev:hybrid
```

Seeded logins (password is `password`):

- `admin@hiroapp.com`
- `recruiter@hiroapp.com`
- `candidate@hiroapp.com`

A candidate is `User` with `role_id = 2`. There is no Candidate model.

## Tests

```bash
bun run test:hiroapp
```

HiroApp tests run after framework `test:coverage` in `validate:ci`. They are gated by `bun run test:hiroapp:coverage`.

## Layout

- `src/models`: Active Record models (relations, morph comments, soft deletes)
- `src/modules`: HTTP APIs, policies, form requests, HTML pages
- `src/db`: migrations, factories, seeders
- `resources/views`: Eta templates
- `frontend`: Candidate SPA (`base: /apply/`)
- `public`: HTMX static assets (`/assets/app.css`), served from this app directory even when the process starts at the monorepo root

## Auth quick map

| Path | How you prove who you are |
|------|---------------------------|
| `/login` | Cookie session + CSRF (staff) |
| `/apply` | Candidate SPA, opaque token from `/api/apply/login` |
| `/api/user` | Cookie, opaque Bearer, JWT, or Basic |
| `/api/auth/token` | Email + password, returns a tight JWT (no CSRF) |
| `/api/integrations/ping` | Bearer token with `integrations:ping` |
| `/login/sso` | OAuth / OIDC / mock |

Details: [docs/AUTH.md](../../docs/AUTH.md).
