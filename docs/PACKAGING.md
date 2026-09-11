# Framework packaging

**Strata** is the framework. **HiroApp** (`apps/hiroapp`) is in-repo dogfood for internal end-to-end testing. Framework code lives in `src/core/` and `src/bootstrap/`. Generated apps live in `apps/`. Extraction to a separate repository is optional.

## Public API

Application modules should import **subpaths**. The root `@getstrata/core` barrel exists for publish and verify. CI rejects it in app source (`scripts/verify-no-root-imports.ts`, `scripts/verify-no-shared-barrel-imports.ts`).

```typescript
import { Policy } from "@getstrata/core/auth/policy";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { FormRequest } from "@getstrata/core/http/formRequest";
```

The barrel file is `src/framework/public-api.ts`. The workspace package `packages/strata-core` re-exports it.

Do not import deep paths from other modules when a public export exists. Add the export to `public-api.ts` instead.

Shared subpath shims are `export * from` the barrel. Every value those subpaths declare in `.d.ts` must also be exported from `public-api.ts`, or the import type-checks and then crashes at runtime. `scripts/verify-export-types.ts` compares `.d.ts` names to the built JS keys.

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

### 1. Bump

A release moves the same version through four different shapes: five `package.json` `version` fields, bootstrap's `@getstrata/core` peer range, the `EXPECTED` map in `scripts/verify-package-versions.ts`, the generated-app pins in the starter template and `renderEnv.ts`, the tests asserting those pins, and four changelogs. `bun run bump` edits all of them together:

```bash
bun run bump 1.0.7 --check                     # list what would change, write nothing
bun run bump 1.0.7 --notes "- What shipped."   # apply
```

The bump refuses a version older than the current one, and is a no-op when every file already matches. Open it as its own PR and merge it before tagging.

### 2. Check before tagging

`v1.0.6` was tagged on a commit whose packages still said `1.0.5`. The release workflow rejected it, but only after the tag existed, so the tag had to be force-moved. Run the check first; it needs no network unless `--check-npm` is passed:

```bash
bun run release:check                                   # report the releasable version
bun run release:check v1.0.7                            # assert the tag matches all five
bun scripts/verify-release-ready.ts v1.0.7 --check-npm  # also refuse an already-published version
```

When a tag is passed, the versions are read from **`origin/main`**, not from your working tree, because `origin/main` is what gets tagged. Bumping on a branch and checking before the merge lands therefore fails:

```
- origin/main is at 1.0.6 but this working tree is at 1.0.7.
  Tagging origin/main would publish 1.0.6. Merge the bump first.
- HEAD is not contained in origin/main, so the code verified here is not
  the code that would be tagged.
```

Nothing in `release.yml` enforces that a tag sits on `main`, so this check is the guard. Use `--ref=<ref>` to compare against a different branch, and `--no-target-check` to skip it. `bun run release:check` without a tag reads the working tree and is what `validate:ci` runs, so a branch build is unaffected.

### 3. Tag

Do this after the bump is on `main`, and tag the merge commit (not the PR branch). Trusted publishers on all five npm packages must already be saved (see below):

```bash
git fetch origin main
bun scripts/verify-release-ready.ts vX.Y.Z
git tag vX.Y.Z origin/main
git push origin vX.Y.Z
```

The tag must equal `v` plus the lockstep version in all five package.json files (`packages/strata-core`, `strata-bootstrap`, `strata-cli`, `strata-starter`, and `create-strata`). Watch the **Release** workflow, job **publish-framework**. GitHub Release and GHCR wait until that job succeeds. GitHub may show `+ package@version` before `npm view` sees it; wait a few minutes, then check all five packages:

```bash
npm view @getstrata/core version
npm view @getstrata/bootstrap version
npm view @getstrata/cli version
npm view @getstrata/starter version
npm view create-strata version
```

Confirm provenance landed (`dist.attestations` was missing on 1.0.4). Each of these should print a non-empty object, not `undefined`:

```bash
npm view @getstrata/core dist.attestations
npm view @getstrata/bootstrap dist.attestations
npm view @getstrata/cli dist.attestations
npm view @getstrata/starter dist.attestations
npm view create-strata dist.attestations
```

Do not:

- Tag a PR branch or a commit that is not `origin/main`.
- Tag before the five trusted publishers are saved on npmjs.com. The next publish will fail.
- Use Actions, Release, Run workflow as the first npm publish. Push the git tag first. If that publish fails or is partial, retry with Run workflow and the same tag; versions already on npm are skipped.
- Change the workflow so a merge to `main` publishes. Keep the first publish on an explicit tag push.

## npm publish (`@getstrata`)

Publishing uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) (GitHub Actions OIDC) plus provenance. The publish job does not use a long-lived npm token.

Configure a GitHub Actions trusted publisher on each of the five packages **before** tagging 1.0.5 (and any later first tag that uses this workflow). On npmjs.com, open the package, Package Settings, Trusted Publisher, GitHub Actions:

1. Organization or user: `EyK-26`
2. Repository: `strata`
3. Workflow filename: `release.yml` (filename only, including `.yml`)
4. Leave Environment empty. The Release workflow does not use a GitHub Environment.
5. Allow `npm publish`. Publisher configs created after 3 September 2026 may default to `npm stage publish` only; the release job runs `npm publish`.

Repeat for `@getstrata/core`, `@getstrata/bootstrap`, `@getstrata/cli`, `@getstrata/starter`, and `create-strata`.

The publish job runs on GitHub-hosted `ubuntu-latest` with `id-token: write`. OIDC does not work on self-hosted runners. Do not set `NODE_AUTH_TOKEN` or `NPM_TOKEN` on that job; an empty `_authToken` in `.npmrc` blocks OIDC.

Then:

1. The [`@getstrata`](https://www.npmjs.com/org/getstrata) org must exist on npm, and the trusted publishers above must be saved.
2. Push `vX.Y.Z` as above. The release workflow publishes from the tag. If that version is already on npm, it skips publish. It does not unpublish older versions. GitHub Release and GHCR wait on npm (they do not wait on each other). The container job uses `docker build --pull` (same as CI `docker-install`) so it refreshes `oven/bun:1.4` and does not pull BuildKit from Docker Hub.
3. If npm fails after the tag exists (trusted publisher misconfigured, or a later package in the five fails), do not delete the tag. Actions, Release, Run workflow, set `tag` to the existing tag (example `v1.0.5`). That retries publish and skips versions already on npm, then creates the GitHub Release and GHCR image. Use the same path to finish GHCR or notes if those jobs failed after npm succeeded.

See `packages/strata-core/CHANGELOG.md` for release notes.

## Container image

The release stage installs production dependencies only (`bun prune --production`
after the framework build), which needs `bun.lock` to agree with every
`package.json`. `bun run bump` refreshes the lockfile for that reason; a
hand-edited version will make the prune fail.

`CMD` runs `bun packages/strata-cli/cli.ts start` rather than `bun run start`.
The install stage copies the workspace `package.json` files alone so the
dependency layer caches, which means bun links bins before any source exists and
`node_modules/.bin/strata` is never created. Going through `bun run start` fails
with `strata: command not found`.

`src/` and `apps/hiroapp` both ship: the root server is a shim that imports the
dogfood app (`apps/hiroapp`, internal end-to-end testing) through `src/bootstrap/dogfoodApp.ts`.

If a GHCR push uploads every layer and then fails on the manifest with an
empty-body `403`, the package storage quota is the first thing to check. Private
packages count against it; public ones do not.

## OpenAPI and SDK

```bash
DOGFOOD_APP=hiroapp APP_KEY_PREFIX=hiroapp APP_NAME=HiroApp API_PREFIX=/api bun run cli openapi:generate
bun run cli openapi:check
```

CI fails if `docs/openapi.json` drifts. Commit regenerated files. The TypeScript client lives in `sdk/typescript/client.ts` (`HiroAppClient`).
