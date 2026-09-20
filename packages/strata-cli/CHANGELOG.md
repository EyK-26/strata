# @getstrata/cli changelog

## 1.1.5

- Close dogfood gaps: webhook docs, starter extras, signing helper

## Unreleased

- `make:module` appends a `registerModelClass` hint to `src/models/register.ts` when that file exists.
- `openapi:check` drift output reminds you to run `openapi:generate` in CI.

## 1.1.4

- Publish http/uploads, validateUploadFile, migration-adoption docs

## 1.1.3

- Eager with() arrays, OpenAPI mkdir, public-read/auth docs

## 1.1.2

- Product CLI helpers, file migrations, and job discovery.

## Unreleased

- Export `queueWorker`, `queueFailed`, `scaffold`, `openapi`, and `schedule` subpaths. Generated apps register `queue:work` through `runQueueWorkerCommand({ boot, close })` (no secrets guard in the helper), plus failed-job commands, `make:*`, `openapi:*`, and `schedule:run`. Monorepo `queue:failed` / `retry` / `flush-failed` go through `createQueueFailedCommands()` so they type as `StrataCommand`. `boot` may return a value (`bootstrapApp()` returns the app).
- `make:job` emits `static jobName`. `make:request` imports `@getstrata/core/http`. `make:module --with-web` writes `views/` when that directory exists.
- Peer dependencies on `@getstrata/core` and `@getstrata/bootstrap`.

## 1.1.1

Fix generated app boot

## 1.1.0

Lockstep with `@getstrata/core` 1.1.0. No new CLI commands. See the core 1.1.0 migration list.

## 1.0.9

Label HiroApp as internal e2e dogfood and seed notes via Model

## 1.0.8

- Container image starts and ships production dependencies only.

## 1.0.7

## 1.0.6

- Lockstep with `create-strata` 1.0.6. No runtime changes.

## 1.0.5

- Lockstep with `create-strata` 1.0.5. No runtime changes.

## 1.0.4

- Lockstep with `create-strata` 1.0.4. No runtime changes.

## 1.0.3

- Lockstep with `create-strata` 1.0.3. No runtime changes.

## 1.0.2

- Lockstep with `create-strata` 1.0.2. No runtime changes.

## 1.0.1

- `strata --help` and `strata -h` print help instead of reporting an unknown command.
- `migrate` and `migrate:fresh` call an optional `close()` export from the app's migrate entry. Without it, a pooled driver such as `mysql2` kept the event loop alive and the command hung after finishing its work.
- Dropped the `prepublishOnly` build. It produced a `dist/` that `files` never shipped; the `bin` is the Bun TypeScript entry.
- README no longer advertises `strata new`, which this package does not implement.
- `migrate` prints `Migrations applied.` and `migrate:fresh` prints `Database reset and migrated.` on success instead of exiting silently.

## 1.0.0

- First stable release of the `strata` binary: `dev`, `start`, `migrate`, `migrate:fresh`, `run`, plus app-registered commands.
