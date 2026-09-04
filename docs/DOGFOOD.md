# Dual dogfood

Strata keeps two in-repo reference apps. They do not share a database.

| App | Path | What it dogfoods | How to run |
|-----|------|------------------|------------|
| HiroApp | `apps/hiroapp` | Hiring domain, Laravel-shaped Eloquent / HTTP, and staff Fortify/Jetstream identity (Wave 6) | `bun run dev` or `bun run hiroapp:dev:htmx` |
| WorkHub | `src/modules` | Teams, SCIM, tenant RLS, billing, webhooks (until Waves 7–10 land on HiroApp) | `bun run workhub:dev` |

WorkHub and HiroApp both have `users`, `sessions`, and `notifications` with **different schemas**. HiroApp rewrites `DATABASE_URL` to `hiroapp_test` (or `HIROAPP_DATABASE_URL`). Do not point both apps at one database.

## Wave 5

Wave 5 retires WorkHub as the **developer default**. `bun run dev` starts HiroApp.

Wave 5 does **not**:

- Delete WorkHub
- Port Jetstream teams, SCIM, or tenant RLS onto HiroApp
- Flip `readDogfoodApp()` when `DOGFOOD_APP` is unset
- Change CI, `validate:ci`, coverage, or smoke — those stay WorkHub-gated

## Wave 6

Staff (admin `role_id=1`, recruiter `role_id=3`) get Fortify/Jetstream account surfaces on HiroApp cookie sessions: profile, password, MFA, PATs, browser sessions, and logout-other-devices. Candidates (`role_id=2`) may change profile and password only.

HiroApp identity is `User` + `role_id` (admin / recruiter / candidate). A candidate is a `User` with `role_id = 2`. That does not map onto WorkHub’s team + `tenant_id` model. Teams / SCIM / RLS stay WorkHub-only until Waves 7–9.

`notifiable_type` stays `App\Models\User`.

## Wave 7

Staff membership lives on departments (`department_members`, `department_invitations`, `users.current_department_id`). Recruiter “my department” is current team membership, with occupied-position as a fallback. Candidates stay applicants: they cannot inspect teams or be invited onto a hiring team.

## Wave 8

HiroApp hiring tables carry `tenant_id` with Postgres RLS (`TENANCY_DRIVER=rls`). Staff requests are scoped to the signed-in user’s tenant. Admins may switch with `x-tenant-id`; recruiters cannot spoof it. Candidates stay tenant-scoped applicants, not org members. Cookie-session identity lookups bypass tenant scope so an admin can still load their own `users` row after switching tenants.

## Commands

```bash
bun run hiroapp:fresh
bun run dev                      # HiroApp (Wave 5 default)
bun run hiroapp:dev:htmx         # HiroApp HTML skin

bun run workhub:fresh
bun run workhub:dev              # Jetstream / SCIM / RLS
bun run workhub:dev:htmx
```

`scripts/with-host-env.sh` sets `DOGFOOD_APP=workhub` so `validate:host`, `dev:host`, and CI `strata start` keep the WorkHub schema and smoke tokens.

`bun run test:coverage` is the WorkHub 100% gate. `bun run test:hiroapp` runs after it in `validate:ci` and does not enter that gate.

## Ports

Both `dev` scripts default to `PORT=3000`. Do not leave HiroApp `dev` running while you run WorkHub host validate or session integration tests — the HMAC browser-session test flakes when another app holds the port or leaks `DOGFOOD_APP=hiroapp` into WorkHub cookies.
