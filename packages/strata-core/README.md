# @getstrata/core

Stable **Strata** framework surface for application modules.

**Source:** `src/framework/public-api.ts` (monorepo)  
**Repository:** [EyK-26/strata](https://github.com/EyK-26/strata), directory `packages/strata-core`

WorkHub is the reference application built on Strata; import the framework from this package in your own modules.

## Usage

Set `DATABASE_URL` before importing (connection is created lazily on first query):

```typescript
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/myapp";

import {
  AdminResourceRegistry,
  BaseRepository,
  EtaViewEngine,
  FormRequest,
  Policy,
  formatAdminValue,
  mailer,
  storage,
  withErrorHandling,
} from "@getstrata/core";
```

**Dependency:** `eta` is bundled as a direct dependency of `@getstrata/core`. Apps do not need to list it separately. The database driver is your app's choice. WorkHub and getstrata use **Bun's built-in `Bun.sql`** client; bind it with `bindDatabaseConnection()`.

`orderBy` accepts explicit `{ column, direction }` objects or column shorthand such as `{ published_at: "desc" }`.

## Admin and queue helpers

Exports for admin dashboards and queue recovery:

- `AdminResourceRegistry`, `formatAdminValue`: read-only resource browsers
- `createFailedJobService`, `FailedJobService.delete()`: failed job persistence and cleanup
- `runQueueJob`, `jobRegistry`: dispatch retried jobs from admin UIs

## Build and verify (monorepo root)

```bash
bun run build:framework
bun run verify:framework   # build + public API tests
```

## Publish to npm

Package name: **`@getstrata/core`** (npm org [`@getstrata`](https://www.npmjs.com/org/getstrata)).

1. Add `NPM_TOKEN` to GitHub repository secrets.
2. Tag a release: `git tag v0.5.13 && git push origin v0.5.13`
3. [Release workflow](../../.github/workflows/release.yml) builds and runs `npm publish --access public`.

Previously published as `@eyk-workhub/framework@0.1.0`, deprecated in favor of this package.

See [docs/PACKAGING.md](../../docs/PACKAGING.md) for boundaries and future extraction.
