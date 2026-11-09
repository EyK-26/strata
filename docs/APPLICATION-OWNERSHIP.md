# Explicit application ownership

This is the ownership foundation of the breaking framework refactor. The candidate
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

## Typed application services and settings

Use opaque tokens and declaration helpers to compose application values. Two tokens
with the same diagnostic name have different identities. Import shared constants
instead of reconstructing them by name. The supported core and bootstrap contract
exports preserve each token's identity; strings remain legacy container keys.

```ts
import { createServiceToken } from "@getstrata/core/contracts/token";
import { service, valueService } from "@getstrata/core/contracts/services";
import {
  configEnum,
  configInteger,
  parseApplicationConfig,
} from "@getstrata/core/config/applicationConfig";
import { createApplication } from "@getstrata/core/runtime/application";

const settings = parseApplicationConfig(
  { PORT: { required: true }, DRIVER: { default: "memory" } },
  { PORT: "3000" }, // Explicit input; pass process.env here when intended.
  (values) => ({
    port: configInteger("PORT", values.PORT, { minimum: 1, maximum: 65535 }),
    driver: configEnum("DRIVER", values.DRIVER, ["memory", "redis"]),
  }),
);
const Settings = createServiceToken<typeof settings>("orders.settings");
const Endpoint = createServiceToken<string>("orders.endpoint");
const app = createApplication({
  providers: [],
  services: [
    valueService(Settings, settings),
    service(Endpoint, {
      lifetime: "application",
      dependencies: [Settings],
      create: (config) => `http://localhost:${config.port}`,
    }),
  ],
});
await app.start();
const endpoint = await app.run((scope) => scope.resolve(Endpoint));
await app.stop();
```

The parser validates selected own input fields, calls the converter with frozen
validated strings, then copies and deeply freezes plain settings. It rejects
accessors, cycles and exotic output values. Input is always explicit. Framework
validation errors identify fields and rules without including their input values;
converter-thrown errors remain caller-owned and retain their identity. Service
values themselves are not copied or frozen.

Graph validation occurs during construction, before any factories or providers
run. It rejects duplicates, missing dependencies, cycles, invalid overrides and
application services that depend on execution services, including through aliases.
Factories initialize exactly once in dependency order during `start()`, before
providers and transports. They receive only the values in their dependency tuple.
Async factories initialize a value; Promise/thenable payloads are unsupported.

Declarations are immutable helper-issued objects. Do not spread or reconstruct
their erased fields: copies are rejected before effects. Use a new helper call
for replacements.

Use `aliasService(aliasToken, targetToken)` for another token of the same value
type. `overrides` accepts replacement declarations for existing tokens. Replacing
a target updates all its aliases; replacing an alias changes only that node. The
final graph is validated after replacements. Composition is sealed before provider
setup, and the application exposes only typed resolution.

A command's resolver expires when its callback finishes. Ordinary synchronous
results close it immediately; callable/accessor `then` candidates use native
Promise normalization and close it before completion observers run. Saved scopes
cannot regain access. Provider resolution similarly expires after setup. An
aborted startup cannot publish a late factory result as a ready service.

This checkpoint supports resource-free application values. Execution lifetimes
are recognized for graph diagnostics but reject as unsupported. Request/job
scopes and resource service declarations follow in the next checkpoint. Existing
provider acquisition remains the resource ownership API described above.

## Migration boundary

The new owner never delegates to the existing global owners. The CLI's direct-child
supervisor now uses it as described below. The remaining consumers must migrate
before final acceptance:

| Existing mechanism | Replacement milestone |
| --- | --- |
| `App`, `createAppContext`, provider cleanup arrays, default lifecycle | Explicit owner and provider migration, M1/M2 |
| Application registry and implicit context lookup | Typed dependencies and execution scopes, M2–M5 |
| Default database pool, connection/model globals | Application-owned database/session contracts, M3 |
| Auth/policy lookup and duplicated HTTP routing | Explicit security dependencies and one route plan, M4 |
| Generated entrypoints and CLI composition | Candidate-package commercial apps, M5/M6 |
| Superseded exports and compatibility paths | Complete deletion and distribution qualification, M7 |

### CLI direct-child supervision

The existing `start`, `dev` and `run` commands use the owner to supervise their direct
Bun child and the supervisor's own SIGINT/SIGTERM callbacks. The child is journaled
before signal registration. The first observed signal determines shutdown; repeated
signals do not repeat the supervisor's kill operation. Cleanup waits for acknowledged
child exit before removing its callbacks, preserving unrelated listeners.

A successful kill call or elapsed stop deadline does not prove the child exited.
Signal-delivery errors remain failures even if the child later exits safely. Rejected
exit observation retains ownership instead of claiming disposal. The private adapter
keeps any known exit code separate from startup, relay and cleanup failures; a clean
run returns the child's actual numeric exit code.

This owns a direct child, not its arbitrary descendants. Signals before relay
installation are outside this helper's observation window. Parent configuration,
preload and custom-command discovery happen before this supervisor and retain their
existing behavior. The child's auth, database and application state also remain on
their existing runtime. Those paths still need the migrations in the table above.

The final framework must have one owner. Keeping this proof alongside the old
implementation permanently, or falling back to the last started application,
does not satisfy the refactor.

Source unit tests, installed-package acceptance and import-boundary checks are
separate evidence. A passing ownership proof does not qualify browser behavior,
auth/ORM isolation, the full starter matrix or a release.

`bun run check:application-boundary` enforces the explicit dependency graph of the
owner, service composition, token contracts and configuration modules. It is also
part of `check:module-imports` and the existing validation gate. Contract-only
modules must erase completely; runtime edges are limited to the declared neutral
modules. Six standalone public artifacts have separate built-import checks. Ambient resource names are conservatively reserved even
for local bindings. This is a maintenance rule, not a sandbox for hostile code.

The remaining legacy owners, string keys and consumers are enumerated in
[the migration ledger](architecture/m21-legacy-callers.txt). Their continued
presence does not establish application isolation for those paths.
