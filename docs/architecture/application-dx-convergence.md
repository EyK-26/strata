# Application developer experience convergence

Base: merged PR #407 (`63da56f`). One new PR; bounded commits and affected tests,
then installed consumer journeys and integrated gates. No release/version changes.
Laravel-shaped authoring must preserve Bun handlers, explicit session ownership,
transaction/tenant policy, cancellation and cleanup. New findings join this ledger.

| Audit item | Deliverable | State |
| --- | --- | --- |
| Factory/model mismatch | Working model → factory workflow | Implemented; focused checks pass |
| Invalid job identifiers | Shared scaffold validation before writes | Implemented; focused checks pass |
| Command help writes files | Side-effect-free per-command help | Implemented; focused checks pass |
| Configured module directory ignored | Shared resolved application paths | Implemented; focused checks pass |
| Application bootstrap | Packaged composition; small app-owned declaration | Implemented; focused checks pass |
| Dual provider APIs | One ordinary provider API; internal adapter boundary | Implemented; focused checks pass |
| Module scaffolding | Model/controller/request/policy without forwarding layers | Implemented; focused checks pass |
| Auth source scanning | Explicit identity declarations, no source inference | Implemented; focused checks pass |
| Auth workflow duplication | Packaged stable workflows with app extension points | Implemented; focused checks pass |
| Routes/controller dependencies | Concise typed composition over owned Bun handlers | Implemented; focused checks pass |
| CLI wiring/errors | Built-ins and adapters packaged; helpful diagnostics | Implemented; focused checks pass |
| Migration infrastructure | Owned packaged runner and bound schema authoring | Implemented; focused checks pass |
| Listener/factory authoring | Concise helpers preserving delivery semantics | Implemented; focused checks pass |
| Configuration | Validated typed snapshot and strict numeric options | Implemented; focused checks pass |
| Consumer ports | Events/policy/queue consumer authority separated | Implemented; focused checks pass |
| Public/test internals | Dedicated testing surface and advanced API guidance | Implemented; focused checks pass |
| Stale executable templates | One source of truth for generated runtime | Implemented; focused checks pass |
| Unselected frontend artifacts | Generated inventory follows selected features | Implemented; focused checks pass |
| Generator metadata | Separate configuration from optional diagnostics | Implemented; focused checks pass |
| Stale maintained docs | Current executable examples and workflow checks | Implemented; focused checks pass |
| Internal responsibility splits | Targeted HTTP/ORM/adapter extraction | Implemented; focused checks pass |
| Integration gaps | Complete CLI journeys and packaged app validation | Implemented; focused checks pass |

Completion requires behavior and evidence, not simply moving text into another file.
Keep intentional advanced capabilities; do not introduce global model connections,
request-time reflection or cosmetic runtime rewrites.

## Review boundaries and additional defects

The ordinary app contract is `defineApp` plus `defineProvider` (`setup`/`boot`).
Existing advanced module/provider adapters still run behind the bootstrap lifecycle bridge;
no generated app needs to copy that bridge. Explicit model and repository registration,
transaction-bound persistence, and app-specific account mapping remain deliberate extension
points. Bun owns HTTP and the supported native SQL, Redis and filesystem paths; MySQL retains
its qualified optional adapter. No request-time reflection or
ambient model connection was introduced.

Additional defects found while implementing and challenging the changes:

- Legacy provider boot ran before canonical provider boot; registration and boot now obey
  their respective phases, including cleanup when either phase fails.
- CLI migrations, seeding and destructive reset re-read ambient environment values. One
  captured environment now reaches provisioning, migration commands and the production guard.
- Relative storage and SQLite paths could target the launching process directory. Generated
  apps resolve them from their app root; absolute paths and SQLite memory databases retain
  their meaning.
- Invalid startup settings and missing worker Redis configuration could fail after schema
  side effects. Configuration and transport preflight now run before provisioning/migration.
- Conditional auth schemas widened generated token/JWT expiry types. Typed integer schemas
  preserve numeric contracts on TypeScript 5.9, 6 and 7.
- Standalone factories created incomplete module directories, breaking discovery. Factories
  now live in `src/db/factories`, resolve existing standalone or module record types, and
  reject missing models without writing. Nested model names are covered.
- The bootstrap root and application subpath needed one composition-token identity. A
  canonical package shim and installed-consumer identity checks enforce that boundary.
- A closed MySQL adapter could reopen its pool through a retained handle. Closing now seals
  admission, joins admitted work and observations, and closes once, including pending loads.
- Immediate outbox worker start/stop could attempt work after application admission closed.
  Deferred work now checks the application shutdown signal before admission; independent
  work failures remain visible.
- The new private MySQL build initially bundled its optional driver. Build externals and
  package verification now enforce lazy loading at the canonical private adapter boundary.
- Version-bump tooling still read the deleted template manifest. The renderer is now the
  single source for generated manifests and runtime-version checks.

## Evidence

- Installed generated apps: ten representative profiles × TypeScript 5.9.3, 6.0.3 and 7.0.2;
  public token/model identity checks and frontend builds.
- Installed model → factory → module → migration → query journeys on SQLite, PostgreSQL and
  MySQL, including custom module paths, nested names, persistence and rejected expired scopes.
- Auth: cookie/token HTTP, CSRF, MFA, account suspension, tenant isolation, SMTP verification
  and password reset, replay rejection and signup uniqueness races.
- Native lifecycle checks: HTTP/worker ownership, captured configuration across asynchronous
  startup, phase ordering, rollback/cleanup failures, and signal-driven shutdown.
- Eight canonical generated-output profiles remain reviewed. Minimal output changes from
  51 to 31 files, 833 to 305 source TypeScript lines, and 520 to 101 bootstrap lines. The largest
  profile changes from 97 to 83 files and 760 to 298 bootstrap lines.

Integrated verification is recorded in the PR; focused checks alone are not a substitute
for the final package, regression, coverage and browser gates.
