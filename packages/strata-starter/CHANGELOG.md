# create-strata changelog

## 3.3.0

Generated apps install the 3.3.0 bootstrap and CLI, including the optional multi-domain resolver and API-only PostgreSQL RLS module scaffold.

## 3.2.0

Apply code and template styling and formatting

## 3.1.9

Fix graceful shutdown during the first SQL outbox poll.

## 3.1.8

Fix graceful shutdown for admitted outbox completions

## 3.1.7

Fix graceful shutdown for admitted queue jobs

## 3.1.6

fix: drain admitted request bookkeeping during shutdown

## 3.1.5

Generate applications with the corrected 3.1.5 core class-model type declarations. Existing generated source files are not rewritten by a package upgrade.

## 3.1.4

- Update generated React browser acceptance to verify the authenticated account dashboard after removing the Notes example. Preserve credential, CSRF, tenant-isolation and business-write checks in test-owned fixtures.
- Coordinate generated app dependency pins at 3.1.4. Includes the 3.1.3 starter cleanup; the failed 3.1.3 release stopped before npm publication.

## 3.1.3

- Generate only the auth imports, helper declarations and controller service aliases required by selected features. Validate unused declarations across generated backend, frontend and CLI files.
- Remove the historical Notes model, table, seed and React example. Keep models required by selected features, and provide a User factory for auth-enabled apps.
- Check the recorded starter migration for readiness; health remains degraded before migration or after rollback.
- Generate an explicit outbound webhook dispatcher with caller-selected public payloads instead of a demo-model listener.
- Generate application dependencies targeting the coordinated 3.1.3 release. Existing generated applications are not rewritten by an upgrade.

## 3.1.2

- Align both generator package descriptions with Laravel-inspired Bun and TypeScript development. Keep simple generator commands in quick starts and document optional cache troubleshooting. Clarify that `bun install` installs the generated application CLI dependency.
- Generate application dependencies targeting the coordinated 3.1.2 release; application runtime behavior is unchanged.

## 3.1.1

- Generate an application-specific AGENTS.md with the selected stack, conventional feature workflow, public API guidance, access-control rules and available commands. Link it from the generated README; framework contributor instructions are not copied into apps.

## 3.1.0

- Generate class models with one typed field declaration and no mandatory repository exports.
- Move selected HTTP handlers into named controllers and application routes into `src/routes/api.ts` and `web.ts`. Controllers receive concrete dependencies; route composition resolves services at startup. Preserve account workflows, middleware, SSO state binding and tenant isolation.
- Align generated guidance and scaffolding with Laravel 13 conventions using native Bun/TypeScript execution. Existing generated apps are not rewritten by a package upgrade; see the application workflow guide in docs/BUILDING-APPS.md.

## 3.0.8

Synchronize packages and correct installed starter template discovery. Both generator entrypoints include their selected templates in published packages.
