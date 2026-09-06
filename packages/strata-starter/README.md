# @getstrata/starter

The `create-strata` generator for [Strata](https://github.com/EyK-26/strata). Requires Bun (tested on 1.4.x).

Prefer the short form, which resolves the [`create-strata`](https://www.npmjs.com/package/create-strata) package:

```bash
bunx create-strata my-app
```

This package ships the same generator at the same version and also works directly:

```bash
bunx @getstrata/starter my-app
```

## Usage

```bash
bunx create-strata my-app
bunx create-strata my-app --yes
bunx create-strata /tmp/my-app --yes --frontend server-htmx --database postgres --auth cookie --docker
```

A directory path works as well as a bare name; the last path segment becomes the project name.

The wizard asks for each layer. In a terminal, lists use up/down and Enter, or a number key. Extras are toggled one at a time, and only the ones that apply to your auth choice are offered. Passing an inapplicable extra as a flag prints a warning and leaves it off, so `--auth headers --mfa` will not write `FEATURE_MFA=true` into an app with no MFA code.

Layer flags: `--frontend`, `--database`, `--auth`, `--tenancy`, `--cache`, `--queue`, `--mail`, `--spa-prefix`, plus extras (`--mfa`, `--email-verification`, `--scim`, `--metrics`) and their `--no-` forms.

Pick one database engine. Docker Compose is optional (`--docker`, `--no-docker`, `--docker-services=postgres,redis`) and only includes services for the tools you selected. `--docker` with Postgres or MySQL also writes Adminer on port 8080.

## What you get

A Bun and TypeScript app on `@getstrata/core` and `@getstrata/bootstrap` that boots, migrates, and passes `bun run check`. Cookie apps include a restyleable welcome page, `/login`, `/register`, and password reset. Token apps include `POST /api/v1/auth/login` plus register and reset. Tenancy is `none`, `column` (any engine), or `rls` (Postgres only; other engines fall back to `column`). Choices are recorded in `strata.layers.json`.

The `strata` binary installs into the app rather than globally, so use the generated `bun run` scripts.

## Docs

- [Getting started](https://github.com/EyK-26/strata/blob/main/docs/GETTING-STARTED.md)
- [Starter and layers](https://github.com/EyK-26/strata/blob/main/docs/STARTER.md)
- [Building apps](https://github.com/EyK-26/strata/blob/main/docs/BUILDING-APPS.md)
