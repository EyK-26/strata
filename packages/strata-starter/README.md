# create-strata

Interactive starter for [Strata](https://github.com/EyK-26/strata). Pick a kit or pick each layer. Hobby SQLite APIs and enterprise hybrid apps use the same generator.

## Usage

```bash
bunx create-strata my-app
bunx create-strata my-app --kit hobby --yes
bunx create-strata hiring --kit hiroapp-enterprise --yes
```

`--kit` values: `hobby`, `team`, `enterprise`, `custom`, `hiroapp-hobby`, `hiroapp-team`, `hiroapp-enterprise`.

Layer flags: `--frontend`, `--database`, `--auth`, `--tenancy`, `--cache`, `--queue`, `--mail`, `--spa-prefix`, plus corporate extras (`--mfa`, `--scim`, `--kiosk`, `--mysql-mirror`, ...).

Docker Compose is optional and only includes services for the tools you selected. `--docker` writes Compose for every needed service. `--no-docker` skips the file when Postgres, Redis, MySQL, or SMTP already run on the machine. `--docker-services=postgres,redis` writes a subset. The interactive wizard asks after layers when those tools are needed.

## What you get

A Bun + TypeScript app on `@getstrata/core` and `@getstrata/bootstrap` that boots. Cookie kits include `/login`. Token kits include `POST /api/v1/auth/login`. Choices are stored in `strata.layers.json`.

Hiring recipes are **not** a copy of HiroApp. HiroApp stays in `apps/hiroapp`. See [docs/STARTER.md](../../docs/STARTER.md).

## Publish

Released from the strata monorepo on npm as `@getstrata/starter`.
