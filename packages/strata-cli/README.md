# @getstrata/cli

Framework CLI for Strata apps. Bun stays the runtime, installer, and test runner. `strata` owns app lifecycle and framework commands.

```bash
strata dev
strata start
strata migrate
strata run src/scripts/backfill.ts
```

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

`src/cli/register.ts` can export `commands` or `registerCommands()` to add app-specific commands such as `make:*`, `queue:work`, and `openapi:*`.

`strata run <file>` executes a file with the app preload. It is not an alias for `bun run <package.json script>`.

`strata new --frontend=hybrid` copies the staff HTML scaffold and the SPA scaffold. Hybrid keeps HTML at `/` and serves the SPA under `/app/*`.

## This monorepo

`bun run cli <command>` is an alias for `strata <command>`. `bun run dev` starts HiroApp.
