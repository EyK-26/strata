# @getstrata/cli changelog

## 1.0.1

- `strata --help` and `strata -h` print help instead of reporting an unknown command.
- `migrate` and `migrate:fresh` call an optional `close()` export from the app's migrate entry. Without it, a pooled driver such as `mysql2` kept the event loop alive and the command hung after finishing its work.
- Dropped the `prepublishOnly` build. It produced a `dist/` that `files` never shipped; the `bin` is the Bun TypeScript entry.
- README no longer advertises `strata new`, which this package does not implement.
- `migrate` prints `Migrations applied.` and `migrate:fresh` prints `Database reset and migrated.` on success instead of exiting silently.

## 1.0.0

- First stable release of the `strata` binary: `dev`, `start`, `migrate`, `migrate:fresh`, `run`, plus app-registered commands.
