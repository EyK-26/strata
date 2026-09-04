# In-repo dogfood

HiroApp (`apps/hiroapp`) is the Strata dogfood app: hiring domain, Laravel-shaped Eloquent / HTTP, and staff Fortify/Jetstream identity (sessions, teams, SCIM, RLS, webhooks, audit, billing).

WorkHub `src/modules` has been removed. Leftover `src/db` migrations still exist so core tests that need the historical `tenant` / `audit_logs` schema can run. They are not a second product app.

HiroApp rewrites `DATABASE_URL` to `hiroapp_test` (or `HIROAPP_DATABASE_URL`). Do not point leftover `src/db` tests and HiroApp at one database.

## Waves 5–14

Wave 5 made HiroApp the developer default (`bun run dev`). Waves 6–9 ported staff identity, teams, RLS, SCIM, webhooks, audit, and billing onto HiroApp. Wave 10 points CI at HiroApp (OpenAPI, smoke, `bun run test:hiroapp:coverage`) and deletes the WorkHub application tree. Waves 11–14 add the staff hiring pipeline, department CRUD, candidate apply/restore, and first-class interviews. Wave 15 adds a position service so staff can open, update, stop, and reopen hiring without deleting the seat. Wave 16 assigns staff interviewers onto a position. Wave 17 records watch/unwatch hiring events on the candidate watchlist. Wave 18 scores candidates against a position's skills and syncs user/position skill panels through one service. Wave 19 records hiring comments on applications and positions. Wave 20 exports the application pipeline and filters the recruiter dashboard through one reporting service. Wave 21 lists, marks, and sends hiring inbox messages through a notification inbox service. Wave 22 wraps failed-job list/retry for admins. Wave 23 exposes roles, grades, and statuses through a hiring catalog service. Wave 24 records staff interview scorecards. Wave 25 drafts, sends, and records candidate responses to application offers. Wave 26 records a catalog reason when staff reject an application. Wave 27 tracks staff referrals and marks them applied when that email applies. Wave 28 lets staff reschedule a scheduled or confirmed interview. Wave 29 records how a candidate found the role. Wave 30 lets staff publish interview slots that candidates can book. Wave 31 keeps a candidate in the talent pool after a rejection so staff can reach out later. Wave 32 stores reusable offer letter templates that staff can apply when drafting an offer. Wave 33 records background-check status on an application. Wave 34 lets staff submit a position requisition for admin approval. Wave 35 adds a post-hire onboarding checklist on hired applications. Wave 36 lets staff publish an open seat to a public careers board. Wave 37 lets staff merge duplicate candidate profiles without deleting the source user.

`hiroapp:fresh` (and CI `DOGFOOD_APP=hiroapp bun run cli migrate:fresh`) creates the `hiroapp_test` database if it is missing.

Candidates (`role_id=2`) stay applicants — not team members, not SCIM employees, not org tokens. `notifiable_type` stays `App\Models\User`.

## Commands

```bash
bun run hiroapp:fresh
bun run dev                      # HiroApp
bun run hiroapp:dev:htmx         # HiroApp HTML skin
```

`bun run validate:host` builds `@getstrata/core` and `@getstrata/bootstrap` first so HiroApp `migrate:fresh` can import package subpaths on a clean checkout.

`bun run test:coverage` is the framework/core 100% gate. `bun run test:hiroapp:coverage` is the HiroApp domain gate.

## Ports

`dev` defaults to `PORT=3000`.
