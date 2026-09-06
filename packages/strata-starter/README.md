# create-strata

Interactive starter for [Strata](https://github.com/EyK-26/strata). The wizard always asks each layer. Extras (MFA, email verification, SCIM, metrics) are toggled one by one. SQLite APIs and Postgres HTML apps use the same generator.

## Usage

```bash
bunx create-strata my-app
bunx create-strata my-app --yes
bunx create-strata html --frontend server-htmx --database postgres --auth cookie --cache redis --queue redis --docker --yes
```

Layer flags: `--frontend`, `--database`, `--auth`, `--tenancy`, `--cache`, `--queue`, `--mail`, `--spa-prefix`, plus extras (`--mfa`, `--scim`, `--metrics`, ...).

Pick **one** database engine. Docker Compose is optional and only includes services for the tools you selected (`--docker`, `--no-docker`, `--docker-services=postgres,redis`). `--docker` with Postgres or MySQL also writes Adminer.

## What you get

A Bun + TypeScript app on `@getstrata/core` and `@getstrata/bootstrap` that boots. Cookie apps include a restyleable welcome page, `/login`, `/register`, and password reset. Token apps include `POST /api/v1/auth/login` and register/reset. Tenancy is `none`, `column` (any engine), or `rls` (Postgres). Choices are stored in `strata.layers.json`.

In-repo examples (`apps/hiroapp-hobby`, `apps/hiroapp-team`, `apps/hiroapp`) are generated from this same script. See [docs/STARTER.md](../../docs/STARTER.md).

## Publish

Released from the strata monorepo on npm as `@getstrata/starter`.
