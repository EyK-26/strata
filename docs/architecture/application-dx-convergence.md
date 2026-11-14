# Application developer experience convergence

Base: merged PR #407 (`63da56f`). One new PR; bounded commits and affected tests,
then installed consumer journeys and integrated gates. No release/version changes.
Laravel-shaped authoring must preserve Bun handlers, explicit session ownership,
transaction/tenant policy, cancellation and cleanup. New findings join this ledger.

| Audit item | Deliverable | State |
| --- | --- | --- |
| Factory/model mismatch | Working model → factory workflow | Pending |
| Invalid job identifiers | Shared scaffold validation before writes | Pending |
| Command help writes files | Side-effect-free per-command help | Pending |
| Configured module directory ignored | Shared resolved application paths | Pending |
| Application bootstrap | Packaged composition; small app-owned declaration | Pending |
| Dual provider APIs | One ordinary provider API; internal adapter boundary | Pending |
| Module scaffolding | Model/controller/request/policy without forwarding layers | Pending |
| Auth source scanning | Explicit identity declarations, no source inference | Pending |
| Auth workflow duplication | Packaged stable workflows with app extension points | Pending |
| Routes/controller dependencies | Concise typed composition over owned Bun handlers | Pending |
| CLI wiring/errors | Built-ins and adapters packaged; helpful diagnostics | Pending |
| Migration infrastructure | Owned packaged runner and bound schema authoring | Pending |
| Listener/factory authoring | Concise helpers preserving delivery semantics | Pending |
| Configuration | Validated typed snapshot and strict numeric options | Pending |
| Consumer ports | Events/policy/queue consumer authority separated | Pending |
| Public/test internals | Dedicated testing surface and advanced API guidance | Pending |
| Stale executable templates | One source of truth for generated runtime | Pending |
| Unselected frontend artifacts | Generated inventory follows selected features | Pending |
| Generator metadata | Separate configuration from optional diagnostics | Pending |
| Stale maintained docs | Current executable examples and workflow checks | Pending |
| Internal responsibility splits | Targeted HTTP/ORM/adapter extraction | Pending |
| Integration gaps | Complete CLI journeys and packaged app validation | Pending |

Completion requires behavior and evidence, not simply moving text into another file.
Keep intentional advanced capabilities; do not introduce global model connections,
request-time reflection or cosmetic runtime rewrites.
