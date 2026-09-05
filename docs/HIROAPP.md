# HiroApp

HiroApp is the hiring OS that ships in this repo. It is also the teaching app: every framework feature that we claim to support should show up here as a real hiring workflow, not a toy CRUD screen.

There is no second product app in this monorepo.

## People and roles

Everyone is a `User`. Role is `role_id`:

| `role_id` | Name | Typical work |
|-----------|------|----------------|
| 1 | Admin | Departments, positions, audit, SCIM, billing flags |
| 2 | Candidate | Career board, apply, interviews, offers, profile |
| 3 | Recruiter | Pipeline for their department, interviews, scorecards |

Notifications use `notifiable_type = App\Models\User`. Do not change that to `users`.

Password for seeded accounts is `password`.

## What you can click through

1. **Public careers.** `/careers` lists published and scheduled postings. Guests can read. Apply requires a candidate session. Resume upload is multipart (`enctype=multipart/form-data`).
2. **Sign in.** Cookie + CSRF. Optional `/login/sso` for GitHub, OIDC, or the mock provider when `FEATURE_OAUTH_MOCK=true`.
3. **Email confirm.** With `FEATURE_EMAIL_VERIFICATION=true`, an unverified candidate hitting `/account` is sent to `/email/verify`. The mail contains a signed URL.
4. **Staff pipeline.** Positions, applications, interviews, scorecards, comments, watchlists.
5. **Offers.** Staff send offers. Notes encrypt when `FEATURE_FIELD_ENCRYPTION=true`.
6. **Account security.** Password change, TOTP for staff when MFA is on, API tokens with abilities, "sign out other devices."
7. **Partner ping.** A token with `integrations:ping` may call `GET /api/integrations/ping`. A `profile:read` token gets 403. That is a job-board style integration, not a second UI.
8. **JWT scripts.** `POST /api/auth/token` with email and password returns an HS256 JWT. `GET /api/user` accepts it as Bearer.
9. **HTTP Basic.** Same `/api/user` accepts `Authorization: Basic` over TLS. Useful for a private reporting cron.
10. **Audit export.** Admins download JSON or CEF at `GET /api/audit-logs/export?format=json|cef` for a SIEM.

## Layout

```
apps/hiroapp/
  src/bootstrap/     createApp, auth directory, providers
  src/http/          wrapApi, wrapWebAuthenticated, wrapPartnerApi, wrapTokenApi
  src/models/        User, Position, Application, Offer, ...
  src/modules/       routes, policies, services
  src/db/            migrations, factories, seeders
  resources/views/   Eta HTML
  public/            `/assets/app.css`
```

`bun run dev` starts HiroApp. The process entry is `src/bootstrap/server.ts` at the repo root, which only loads HiroApp.

## Auth in this app (concrete)

| Client | Guard | CSRF |
|--------|-------|------|
| HTML forms | Cookie session (`sessions` table) | Yes |
| Browser JSON with cookie | Same cookie | Yes (`x-csrf-token`) |
| Opaque token | `DatabaseTokenGuard` | No |
| JWT | `JwtGuard` | No |
| Basic | `BasicAuthGuard` | No |

See [AUTH.md](./AUTH.md).

## Database

HiroApp is Postgres (`hiroapp_test` by default). Isolated from the framework **fixture** schema in `src/db`, which exists only so core RLS tests have tables. Do not add hiring tables to `src/db`.

## Commands

```bash
bun run hiroapp:fresh
bun run hiroapp:dev:htmx
bun run test:hiroapp
bun run test:hiroapp:coverage
```

## Feature flags you will actually flip

| Flag | Hiring meaning |
|------|----------------|
| `FEATURE_EMAIL_VERIFICATION` | Candidates must confirm email before staff HTML |
| `FEATURE_MFA` | Staff TOTP |
| `FEATURE_OAUTH` / GitHub / OIDC env | Candidate SSO |
| `FEATURE_OAUTH_MOCK` | Local SSO without an IdP |
| `FEATURE_FIELD_ENCRYPTION` | Offer notes and similar secrets |
| `FEATURE_SCIM` | HRIS provisioning of **staff** only |
| `FEATURE_AUDIT_LOG` / `FEATURE_SIEM_EXPORT` | Who changed a hiring record |
| `FEATURE_PUBLIC_READS` | Career board without a session |

Candidates are applicants. They are not SCIM employees and not org-wide API owners.

## Tests

HiroApp tests live in `apps/hiroapp/src/tests`. Set `HIROAPP_TEST=1`. Coverage is gated by `scripts/assert-hiroapp-coverage.ts`.
