# @getstrata/starter

The `create-strata` generator for [Strata](https://github.com/EyK-26/strata). Requires Bun >=1.4.4 (tested on 1.4.4).

Prefer the short form, which resolves the [`create-strata`](https://www.npmjs.com/package/create-strata) package:

```bash
bunx create-strata my-app
```

This package ships the same generator at the same version and also works directly:

```bash
bunx @getstrata/starter my-app
```

## Generation safety and feature plan

Generation validates a frozen feature plan before creating output. Unsupported raw combinations (such as RLS with SQLite or MFA without cookie authentication) fail before files are emitted. Interactive and CLI choices normalize through the installer first. The generated `strata.features.json` records requirements, derived capabilities, required feature artifacts, and a complete emitted file inventory.

Existing output paths are always rejected, including with `--force`; choose a new path. A failed generation removes only the output directory acquired by that attempt so it can be retried.

## Usage

```bash
bunx create-strata my-app
bunx create-strata my-app --yes
bunx create-strata /tmp/my-app --yes --frontend server-htmx --database postgres --auth cookie --docker
```

A directory path works as well as a bare name; the last path segment becomes the project name.

The wizard asks for each layer. In a terminal, lists use up/down and Enter, or a number key. Extras are toggled one at a time, and only the ones that apply to your auth choice are offered. Passing an inapplicable extra as a flag prints a warning and leaves it off, so `--auth headers --mfa` will not write `FEATURE_MFA=true` into an app with no MFA code.

Layer flags: `--frontend`, `--database`, `--auth`, `--tenancy`, `--cache`, `--queue`, `--mail`, `--spa-prefix`, plus extras (`--mfa`, `--email-verification`, `--scim`, `--metrics`) and their `--no-` forms.

Pick one database engine. Docker Compose is optional (`--docker`, `--no-docker`, `--docker-services=postgres,redis`) and only includes services for the tools you selected. The wizard offers optional Adminer in both Docker and Mix modes when the database is in Compose. `--docker` alone includes required services only; add Adminer explicitly with `--docker-services=mysql,mailpit,adminer` (or `postgres`). When selected, start its debug profile with `docker compose --profile debug up -d --wait --wait-timeout 180`; open http://localhost:8080.

## What you get

A Bun and TypeScript app on `@getstrata/core` and `@getstrata/bootstrap` that boots, migrates, and passes `bun run check`. Cookie apps include a restyleable welcome page, `/login`, `/register`, and password reset. Token apps include `POST /api/v1/auth/login` plus register and reset. Tenancy is `none`, `column` (any engine), or `rls` (Postgres only; other engines fall back to `column`). Choices are recorded as provenance in `strata.layers.json`; detailed generator metadata lives in `.strata/generator.json`. Application configuration lives in `src/config/app.ts` and the application definition.

The `strata` binary installs into the app. Use generated `bun run` scripts or `bunx strata`. Package-owned commands provide workers, failed-job operations, scaffolding, OpenAPI and scheduling through the application and schedule entrypoints in `strata.config.ts`. `src/cli/register.ts` adds custom application commands.

Discover registered commands with `bunx strata help`. `dev` and `start` run HTTP only. Run `queue:work` separately for Redis jobs, and `outbox:work` separately for published durable events (after migrations and listener registration). Synchronous queues and apps without durable events do not need these workers. Worker startup messages indicate polling, not dependency health; idle polling is normal. HTTP and workers use the same application configuration.

## Docs

- [Getting started](https://github.com/EyK-26/strata/blob/main/docs/GETTING-STARTED.md)
- [Starter and layers](https://github.com/EyK-26/strata/blob/main/docs/STARTER.md)
- [Building apps](https://github.com/EyK-26/strata/blob/main/docs/BUILDING-APPS.md)

## Work tracker reference

The programmatic generator accepts `reference: "work-tracker"` alongside user authentication and tenant isolation. It emits the same organization/member/project/task domain for cookie/server and token/API applications. Owners manage memberships and projects, members create and complete tasks, and viewers read. `/work` provides cookie-authenticated forms with CSRF protection; `/api/v1/work` exposes the shared workflow for API clients. An authenticated request supplies the tenant and actor; payload fields cannot override them.

Every accepted mutation writes a durable audit record and publishes through the framework SQL outbox inside the same transaction. The included `work.notification` listener records delivery idempotently; run the ordinary outbox worker to consume pending events. The reference uses explicit tenant predicates and composite foreign keys on every driver, and adds PostgreSQL RLS policies when selected. This is a bounded reference workflow, not a complete project-management product.
