# Explicit application ownership

This is the first bounded proof of the breaking framework refactor. The candidate
entrypoint is `@getstrata/core/runtime/application`. It owns provider setup,
resource acquisition, admitted commands and cleanup. It does not yet replace the
existing starter, `App`, HTTP kernel, auth services or ORM.

```ts
import { createApplication } from "@getstrata/core/runtime/application";

const app = createApplication({
  config: { applicationName: "orders" },
  providers: [],
});

await app.start();
const name = await app.run((scope) => scope.config.applicationName);
const stopped = await app.stop();
if (!stopped.successful) {
  // Inspect framework-owned disposition fields. Error payloads remain opaque.
  console.error(stopped.snapshot.cleanup, stopped.snapshot.retainedResources);
}
```

Construction validates declarations and copies plain configuration data without
opening resources. Provider dependencies determine setup order. Transports use
the same acquisition API after provider setup; the owner itself imports no HTTP
server, database driver or global application registry. The acceptance fixture
supplies a real Bun listener, and its handlers enter the selected app through
`run`. That fixture is not a production HTTP/security adapter.

Providers acquire resources through `scope.acquire({ name, open, close, ... })`.
The owner records an acquisition before calling `open`, including operations
that settle after cancellation. Successful opens return `{ ok: true, value }`.
Failed opens explicitly report `not-acquired`, `cleaned` or `unknown` disposal.
Resource specifications and outcomes use own data fields; accessors and inherited
hook methods are rejected. A class adapter can expose a specification whose
callbacks close over the adapter instance.
A raw throw or rejection means `unknown`; an error name or code cannot prove
that a partially opened resource was cleaned. Adapters may attest `cleaned` only
after their internal cleanup actually succeeds.

Stop closes admission, stops producers, waits for active setup and admitted work,
drains, flushes and closes resources in dependency order. A failed stop/drain or
unknown acquisition retains the resources whose safe release cannot be proven.
An abort signal or elapsed timeout does not prove that an operation stopped.
Callbacks must not await their own containing start/stop/run operation.

`start()` shares a promise while starting or ready. Once stopping begins, new
calls return a cached rejection: instances cannot restart. Previously obtained
startup promises keep their historical result. `stop()` shares a bounded result;
its default deadline is 30 seconds. Failed-startup cleanup has its own independent
30-second default. Both budgets are configurable positive integer milliseconds.

`state` and stop results are immutable snapshots. Boot and cleanup are separate
facts: failed startup can still have clean cleanup. A timed-out stop remains a
historical observation even if cleanup later succeeds. The stable, never-rejecting
`completion` promise reports eventual settlement. It remains pending while owned
operations are still running; settled unknown ownership can complete with a
failed disposition and retained obligations. Caller-owned error payloads retain
their identity and are not inspected or frozen.

## Migration boundary

The new owner never delegates to the existing global owners. Their consumers
remain unchanged in this proof and must migrate before final acceptance:

| Existing mechanism | Replacement milestone |
| --- | --- |
| `App`, `createAppContext`, provider cleanup arrays, default lifecycle | Explicit owner and provider migration, M1/M2 |
| Application registry and implicit context lookup | Typed dependencies and execution scopes, M2–M5 |
| Default database pool, connection/model globals | Application-owned database/session contracts, M3 |
| Auth/policy lookup and duplicated HTTP routing | Explicit security dependencies and one route plan, M4 |
| Generated entrypoints and CLI composition | Candidate-package commercial apps, M5/M6 |
| Superseded exports and compatibility paths | Complete deletion and distribution qualification, M7 |

The final framework must have one owner. Keeping this proof alongside the old
implementation permanently, or falling back to the last started application,
does not satisfy the refactor.

Source unit tests, installed-package acceptance and import-boundary checks are
separate evidence. A passing ownership proof does not qualify browser behavior,
auth/ORM isolation, the full starter matrix or a release.

`bun run check:application-boundary` enforces the two migrated source files. It is
also part of `check:module-imports` and the existing validation gate. The check
allows only erased imports/reexports of the application contract; that contract
must erase completely. Ambient resource names are conservatively reserved even
for local bindings. This is a maintenance rule, not a sandbox for hostile code.
