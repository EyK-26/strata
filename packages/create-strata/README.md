# create-strata

Starter for [Strata](https://github.com/EyK-26/strata), a Bun + TypeScript HTTP framework. The wizard asks for each layer, then writes an app you own.

## Usage

```bash
bunx create-strata my-app
bunx create-strata my-app --yes
bunx create-strata /tmp/my-app --yes --frontend server-htmx --database postgres --auth cookie --docker
```

A directory path works as well as a bare name. The last path segment becomes the project name.

In a terminal, lists use up/down and Enter, or a number key. Extras (MFA, email verification, SCIM, metrics) are toggled one at a time, and only the ones that apply to your auth choice are offered.

## Layers

| Flag | Choices |
| --- | --- |
| `--frontend` | `api`, `server-htmx`, `spa-react`, `hybrid` |
| `--database` | `sqlite`, `postgres`, `mysql` (pick one) |
| `--auth` | `headers`, `cookie`, `token`, `jwt`, `cookie-token`, `cookie-token-jwt` |
| `--tenancy` | `none`, `column`, `rls` (`rls` needs Postgres; other engines fall back to `column`) |
| `--cache` | `array`, `redis` |
| `--queue` | `sync`, `redis` |
| `--mail` | `log`, `smtp` |

Extras: `--mfa`, `--email-verification`, `--scim`, `--metrics` and their `--no-` forms. Docker Compose is optional (`--docker`, `--no-docker`, `--docker-services=postgres,redis`) and only includes services for the tools you picked. `--docker` with Postgres or MySQL also writes Adminer on port 8080.

Choices are recorded in `strata.layers.json`.

## After generating

```bash
cd my-app
cp .env.example .env
bun install
bun run db:migrate
bun run dev
```

The `strata` binary is installed into the app's `node_modules/.bin`, not globally, so use the `bun run` scripts or `bunx strata <command>` from inside the app directory. Running `bunx strata` outside a Strata app resolves an unrelated npm package named `strata`.

## Relationship to @getstrata/starter

`create-strata` and [`@getstrata/starter`](https://www.npmjs.com/package/@getstrata/starter) ship the same generator from the same source at the same version. `bunx create-strata` is the documented entry point because `bunx` resolves the package name; `bunx @getstrata/starter` also works.

## Docs

- [Getting started](https://github.com/EyK-26/strata/blob/main/docs/GETTING-STARTED.md)
- [Starter and layers](https://github.com/EyK-26/strata/blob/main/docs/STARTER.md)
- [Building apps](https://github.com/EyK-26/strata/blob/main/docs/BUILDING-APPS.md)
- [Auth choices](https://github.com/EyK-26/strata/blob/main/docs/AUTH.md)
