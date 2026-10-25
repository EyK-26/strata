# @getstrata/cli

The `strata` binary for [Strata](https://github.com/EyK-26/strata) apps. Bun stays the runtime, installer, and test runner; `strata` owns the app lifecycle. Requires Bun >=1.4.4 (tested on 1.4.4).

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

App commands from `src/cli/register.ts` merge with this list. Generated apps add `queue:work`, failed-job commands, `make:*`, `openapi:*`, and `schedule:run`. User-auth starters also add explicit `auth:provision-admin`; its `initialAdmin` subpath reads bounded password input from a pipe and redacts provisioning errors. The app owns its transactional one-time claim and user schema. See [initial-admin provisioning](https://github.com/EyK-26/strata/blob/main/docs/INITIAL-ADMIN.md) before adoption.

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

`src/cli/register.ts` can export `commands` or `registerCommands()` to add your own commands. Generated apps ship `queue:work`, which boots the app (`bootstrapApp` / `createApp`) rather than the monorepo provider stack, plus `make:*`, failed-job commands, `openapi:*`, and `schedule:run`. User-auth starters also add explicit `auth:provision-admin`; its `initialAdmin` subpath reads bounded password input from a pipe and redacts provisioning errors. The app owns its transactional one-time claim and user schema. See [initial-admin provisioning](https://github.com/EyK-26/strata/blob/main/docs/INITIAL-ADMIN.md) before adoption.

Helpers live on package subpaths: `@getstrata/cli/queueWorker`, `@getstrata/cli/queueFailed`, `@getstrata/cli/scaffold`, `@getstrata/cli/openapi`, and `@getstrata/cli/schedule`. `queue:work` takes `{ boot, close }` and does not call `assertProductionSecrets()` (that belongs in app boot). Scaffold commands resolve paths from the app working directory (`src/modules`, `src/db/migrations`, `src/jobs`, `views/` or `resources/views`). See [docs/BUILDING-APPS.md](https://github.com/EyK-26/strata/blob/main/docs/BUILDING-APPS.md#extending-the-cli).

`make:model <Name|Group/Name>` generates an id-only declarative model under `src/models`; its repository comes from `defineModel(table)` and normal startup discovery. Use `--table=existing_table`, `--primary-key=id`, and `--key-type=number|string` for explicit metadata. UUID keys use `string`. Add domain fields to the record, table columns and allowlist before writing them. Migration generation is always separate: `make:migration <name>`. No route or custom repository is generated, and existing files/symlinked parents are refused.

Existing apps must register `makeModelCommand` from `@getstrata/cli/scaffold` (or merge its `scaffoldCommands` map). A dependency upgrade does not rewrite the app-owned command registry. Use `make:model --help` for options.

`make:view reports/summary[.eta]` creates an Eta HTML template under an existing `views/`, or `resources/views/` otherwise. It supports nested names, leading-underscore partials and numeric error pages, and refuses unsafe paths, symlinks and overwrites. It does not create routes/controllers, enable views or change the app's layout/directory configuration. Register `makeViewCommand` from the same scaffold subpath in existing apps; fresh generated registries include it.

A migrate entry may export `close()`. The CLI calls it after `migrate()` and `fresh()` so pooled drivers such as `mysql2` release the event loop instead of hanging the command.

## Creating a new app

This package does not create whole application projects. Use the starter:

```bash
bunx create-strata my-app
```

## Docs

- [Getting started](https://github.com/EyK-26/strata/blob/main/docs/GETTING-STARTED.md)
- [Building apps](https://github.com/EyK-26/strata/blob/main/docs/BUILDING-APPS.md)
