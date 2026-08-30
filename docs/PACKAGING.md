# Framework packaging

**Strata** is the framework; **WorkHub** is the reference application in this monorepo. Framework code lives in `src/core/` and `src/bootstrap/`; application code lives in `src/modules/`. Extraction to a separate repository is optional and documented below.

## Public API

Application modules should import **subpaths**. The root `@getstrata/core` barrel exists for publish/verify, but CI rejects it in app source (`scripts/verify-no-root-imports.ts`, `scripts/verify-no-shared-barrel-imports.ts`).

```typescript
import { Policy } from "@getstrata/core/auth/policy";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { FormRequest } from "@getstrata/core/http/formRequest";
```

The barrel file is `src/framework/public-api.ts`. The workspace package `packages/strata-core` re-exports it.

## Published packages

| Package | Version | Role |
|---------|---------|------|
| `@getstrata/core` | 0.5.89 | Framework runtime and HTTP/database/auth primitives |
| `@getstrata/bootstrap` | 0.2.65 | HttpKernel, providers, web session helpers |
| `@getstrata/cli` | 0.2.0 | `strata` CLI (`dev`, `start`, `migrate`, `run`, plus app-registered commands) |
| `@getstrata/starter` | 0.1.4 | `bun create strata` app scaffold |

## What runs today

| Step | Command / trigger | Status |
|------|---------------------|--------|
| Local build | `bun run build:framework` | Builds `packages/strata-core/dist/` |
| Smoke verify | `bun run verify:framework` | Build + public API unit test |
| CI | `validate:ci` | Includes `verify:framework` on every push |
| npm publish | Push git tag `v*` | `.github/workflows/release.yml` publishes core, bootstrap, cli, and starter |

## npm publish setup (`@getstrata/core`)

Publishing uses the **`@getstrata` npm organization**. Before your first release:

1. Ensure the [`@getstrata`](https://www.npmjs.com/org/getstrata) org exists on npm (you create only the scope name `getstrata`, not `getstrata/core`).
2. Add `NPM_TOKEN` to GitHub repository secrets (Automation token with publish access to `@getstrata/core`).
3. Tag a release:

```bash
git tag v0.5.94
git push origin v0.5.94
```

The release workflow builds the package, pushes the Docker image to GHCR, and publishes to npm.

**Repository metadata** in `packages/strata-core/package.json` points at this monorepo (`EyK-26/strata`, directory `packages/strata-core`).

### Legacy package

`@eyk-workhub/framework@0.1.0` was the initial publish name. New releases use **`@getstrata/core`**. Deprecate the old package on npm after the first Strata release:

```bash
npm deprecate @eyk-workhub/framework@"<0.2.0" "Renamed to @getstrata/core — https://github.com/EyK-26/strata"
```

## Boundaries

| Layer | Path | Role |
|-------|------|------|
| **Framework core (Strata)** | `src/core/`, `src/bootstrap/` (kernel, providers) | Reusable infrastructure |
| **Public barrel** | `src/framework/public-api.ts` | Supported import surface |
| **Workspace package** | `packages/strata-core/` | Build artifact + npm publish |
| **Application (WorkHub)** | `src/modules/`, `src/domain/` | Reference SaaS app |
| **Infrastructure** | `infra/`, `docker-compose*.yml` | Deploy tooling |

Do **not** import deep paths from other modules when a public export exists — add to `public-api.ts` instead.

## Future full extraction (optional)

To split framework code into its own repository later:

1. Move `src/core` and framework bootstrap into `packages/strata-core/src`
2. Keep WorkHub modules in this repo or a separate `@getstrata/bench` package
3. Run the full test suite against the extracted package

No breaking move is required until you split repositories. The current workspace package is the supported path for npm consumers.
