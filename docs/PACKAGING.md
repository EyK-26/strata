# Framework packaging

**Strata** is the framework. **HiroApp** is the in-repo generated example. Framework code lives in `src/core/` and `src/bootstrap/`. Example apps live in `apps/`. Extraction to a separate repository is optional.

## Public API

Application modules should import **subpaths**. The root `@getstrata/core` barrel exists for publish and verify. CI rejects it in app source (`scripts/verify-no-root-imports.ts`, `scripts/verify-no-shared-barrel-imports.ts`).

```typescript
import { Policy } from "@getstrata/core/auth/policy";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { FormRequest } from "@getstrata/core/http/formRequest";
```

The barrel file is `src/framework/public-api.ts`. The workspace package `packages/strata-core` re-exports it.

Do not import deep paths from other modules when a public export exists. Add the export to `public-api.ts` instead.

Modules that own process-wide state (database pool, auth/tenant async-local storage, dialect override) belong in `scripts/core-shared-subpaths.ts`. After you add one, run `bun scripts/sync-package-subpaths.ts` and rebuild.

## Published packages

| Package | Role |
|---------|------|
| `@getstrata/core` | Runtime: HTTP, database, auth, queue, mail |
| `@getstrata/bootstrap` | HttpKernel, providers, cookie session helpers |
| `@getstrata/cli` | `strata` CLI (`dev`, `start`, `migrate`, `run`, plus app-registered commands) |
| `@getstrata/starter` | The interactive layer generator (one database engine per app) |
| `create-strata` | Same generator, same version, under the name `bunx create-strata` resolves |

Versions are asserted by `scripts/verify-package-versions.ts`.

## What runs today

| Step | Command | Status |
|------|---------|--------|
| Local build | `bun run build:framework` | Builds `packages/strata-core/dist/` |
| Smoke verify | `bun run verify:framework` | Build plus public API tests |
| CI | `validate:ci` | Includes `verify:framework` on every push |
| npm publish | Push git tag `v*` on `main` | `.github/workflows/release.yml` publishes core, bootstrap, cli, starter, and `create-strata` |

## Ship a version

Merging a version-bump PR to `main` does not publish. npm, the GitHub Release, and GHCR start when you push a `v*` tag.

Do this after the bump is on `main`, and tag the merge commit (not the PR branch):

```bash
git fetch origin main
# Confirm packages/strata-core/package.json on origin/main is X.Y.Z
git tag vX.Y.Z origin/main
git push origin vX.Y.Z
```

The tag must equal `v` plus the lockstep version in `packages/strata-core/package.json`. Watch the **Release** workflow, job **publish-framework**. That job only runs on a tag `push`. GitHub may show `+ package@version` before `npm view` sees it; wait a few minutes, then check all five packages:

```bash
npm view @getstrata/core version
npm view @getstrata/bootstrap version
npm view @getstrata/cli version
npm view @getstrata/starter version
npm view create-strata version
```

Do not:

- Tag a PR branch or a commit that is not `origin/main`.
- Use Actions, Release, Run workflow for the first npm publish. `workflow_dispatch` creates notes and GHCR only; it skips npm.
- Change the workflow so a merge to `main` publishes. Keep publish on an explicit tag push.

## npm publish (`@getstrata`)

1. The [`@getstrata`](https://www.npmjs.com/org/getstrata) org must exist on npm.
2. Add `NPM_TOKEN` to GitHub repository secrets (Automation token with publish access).
3. Push `vX.Y.Z` as above. The release workflow publishes from the tag. If that version is already on npm, it skips publish. It does not unpublish older versions (the GitHub `NPM_TOKEN` cannot). The GitHub Release job does not wait on Docker. The container job uses `docker build --pull` (same as CI `docker-install`) so it refreshes `oven/bun:1.4` and does not pull BuildKit from Docker Hub.
4. To finish GHCR or GitHub Release notes after a tag without retagging: Actions, Release, Run workflow, set `tag` to the existing tag (example `v1.0.0`). That path skips npm.

See `packages/strata-core/CHANGELOG.md` for release notes.

## OpenAPI and SDK

```bash
DOGFOOD_APP=hiroapp APP_KEY_PREFIX=hiroapp APP_NAME=HiroApp API_PREFIX=/api bun run cli openapi:generate
bun run cli openapi:check
```

CI fails if `docs/openapi.json` drifts. Commit regenerated files. The TypeScript client lives in `sdk/typescript/client.ts` (`HiroAppClient`).
