# @getstrata/cli

The `strata` binary for [Strata](https://github.com/EyK-26/strata) apps. Bun stays the runtime, installer, and test runner; `strata` owns the app lifecycle. Requires Bun (tested on 1.4.x).

## Commands

```bash
strata dev
strata start
strata migrate
strata migrate:fresh
strata run src/scripts/backfill.ts
strata help
```

`strata --help` and `strata -h` print the same list as `strata help`.

`strata run <file>` executes a file with the app preload. It is not an alias for `bun run <script>`.

`strata start` does not migrate when `APP_ENV=production`. Run `strata migrate` as an explicit deploy step.

## Running it

This package installs into your app, not globally, so `strata` lands in `node_modules/.bin` and is not on your `PATH`. Use the scripts a generated app already ships:

```bash
bun run dev
bun run db:migrate
```

Or call it directly from inside the app directory:

```bash
bunx strata dev
```

Running `bunx strata` from outside a Strata app resolves an unrelated npm package named `strata` and starts a static file server. Stay in the app directory.

## How it finds your app

From the current working directory, `strata` loads `strata.config.ts` if present, then falls back to conventions:

| Setting | Convention |
| --- | --- |
| `preload` | `src/bootstrap/preload.ts` or `src/bootstrap/preloadModules.ts` |
| `server` | `src/bootstrap/server.ts` |
| `modulesDirectory` | `src/modules` |
| `commands` | `src/cli/register.ts` |
| `migrate` | `src/db/migrate.ts` |
| `fresh` | `src/db/fresh.ts` |

`src/cli/register.ts` can export `commands` or `registerCommands()` to add your own commands. Generated apps do not ship one, so `make:*`, `queue:work`, and `openapi:*` are yours to write if you want them.

A migrate entry may export `close()`. The CLI calls it after `migrate()` and `fresh()` so pooled drivers such as `mysql2` release the event loop instead of hanging the command.

## Creating a new app

This package does not scaffold. Use the starter:

```bash
bunx create-strata my-app
```

## Docs

- [Getting started](https://github.com/EyK-26/strata/blob/main/docs/GETTING-STARTED.md)
- [Building apps](https://github.com/EyK-26/strata/blob/main/docs/BUILDING-APPS.md)
