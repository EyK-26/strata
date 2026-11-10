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

Stop closes admission, stops producers, waits for active setup and producer stop
convergence, then drains providers. It waits for admitted execution initialization
and entire admitted callback trees to settle before flushing and closing resources
in dependency order. A failed stop/drain or unknown acquisition retains the
resources whose safe release cannot be proven.
An abort signal or elapsed timeout does not prove that an operation stopped.
Callbacks must not await their own containing start/run/spawn operation or application
stop/completion; arbitrary promise cycles are not detected.

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
Application factories initialize exactly once in dependency order during `start()`,
before providers and transports. Execution factories initialize eagerly for each
`run()` before its callback. Both receive only the values in their dependency tuple.
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

## Managed application services

Use `resourceService` for an application service that owns a resource. Its factory
receives the declared dependency values and synchronously returns a `ResourceSpec`;
only the spec's `open` function acquires the resource. Return an explicit
`OpenOutcome` so failed acquisition distinguishes `not-acquired`, `cleaned` and
`unknown` ownership. Ordinary `service` factories do not imply resource disposal.

```ts
import { resourceService } from "@getstrata/core/contracts/services";

const poolBinding = resourceService(Pool, {
  lifetime: "application",
  dependencies: [Settings],
  create: (settings) => ({
    name: "orders.pool",
    open: (signal) => openPool(settings, signal), // Returns OpenOutcome<Pool>.
    close: (pool, context) => pool.close(context.signal),
  }),
});
// Include poolBinding in createApplication({ services: [...], providers: [...] }).
```

Bindings open eagerly once in dependency order, before providers and transports.
Aliases share the acquired value; overrides replace the final graph before any
factory runs. Application resources cannot capture execution services or context.
The factory must not acquire resources or return a promise for its spec.

The existing application journal owns each admitted open and its captured cleanup
hooks. Cancellation can reject startup while an open is still pending; completion
continues to wait for the actual outcome. A late successful open remains owned and
is cleaned without publishing a ready service. A successful handle rejected by
service payload validation also remains owned for cleanup.

Cleanup retains managed backing dependencies through aliases and ordinary service
factories. Every provider and transport conservatively depends on all managed
services because its setup scope can resolve any of them. Unknown acquisition or
failed close retains that owner's backing resources; independent groups can close.
A failed flush is reported even when a subsequent successful close releases the
resource. Resource names are diagnostic labels: duplicates are rejected within one
owner, while separate owners may use the same name without sharing obligations.

Managed services currently support only the `application` lifetime. Execution
bindings and child tasks do not acquire resources through this API yet.

## Explicit executions

This checkpoint supports managed application services and resource-free execution values. Each
`run()` creates a fresh child of the selected application's sealed service
container. Typed dependencies fall back to that explicit parent; legacy string
keys remain local. Execution factories and aliases initialize in dependency order,
then the child seals before the callback runs. Application values retain their
identity across runs, while execution values and context belong to one run.

```ts
import {
  CORE_EXECUTION_CONTEXT_TOKEN,
  createApplication,
  service,
} from "@getstrata/core/runtime/application";
import { createServiceToken } from "@getstrata/core/contracts/token";

const Correlation = createServiceToken<string>("orders.correlation");
const app = createApplication({
  providers: [],
  services: [
    service(Correlation, {
      lifetime: "execution",
      dependencies: [CORE_EXECUTION_CONTEXT_TOKEN],
      create: (context) => context.externalId ?? context.executionId,
    }),
  ],
});
await app.start();
const correlation = await app.run(
  {
    kind: "job",
    actor: { kind: "system", policy: "orders.reconcile" },
    externalId: "reconcile-42",
    metadata: { source: "scheduler" },
  },
  (scope) => {
    // scope.signal === scope.context.signal
    return scope.resolve(Correlation);
  },
);
await app.stop();
```

The callback-only overload uses `{ kind: "command" }`. Explicit envelopes use
`request`, `command` or `job`; jobs require an actor. An actor is either a
`principal` with plain `claims`, or a `system` with a nonempty `policy` string.
Optional tenant, actor and external ID do not inherit from another execution.
These fields carry metadata and grant no authority. Security adapters remain
responsible for validating and interpreting their values.

The immutable context includes owner-generated application/execution IDs, the
composed cancellation signal and copied, deeply frozen plain metadata. Metadata
defaults to an empty record; other absent optional fields stay absent. Envelope
and actor records reject unknown fields, symbols, accessors and hidden fields.
Metadata, tenant and principal claims use the same plain-data rules as application
configuration. Signals must pass platform brand checks; shadow signal getters and
listener methods are ignored. Invalid input returns an observed rejected promise
before factories or callback admission, without changing application boot.

`CORE_EXECUTION_CONTEXT_TOKEN` is the canonical implicit execution dependency.
Aliases to it are execution-lived. Declaring or overriding that token rejects with
`SERVICE_GRAPH_RESERVED_TOKEN`; an application factory capturing it or an
execution alias rejects with `SERVICE_GRAPH_CAPTIVE_DEPENDENCY`. Providers resolve
only application values and cannot resolve execution context.

Each execution composes application cancellation, an optional external signal and
an optional `deadlineAtMs` epoch deadline. Deadlines must be nonnegative safe
integers. A pre-aborted external signal wins over an already expired deadline;
otherwise the first observed cancellation reason wins, preserving opaque reason
identity. Deadlines are checked at factory admission, before successful value
publication and before callback admission, even while timer delivery is delayed.
Deadline errors have code `EXECUTION_DEADLINE` and owner IDs. The owner
removes its listeners and timer after actual settlement; later cancellation cannot
change a settled context's signal.

Cancellation before callback admission skips remaining factories and the callback.
An already admitted factory remains owned until its actual promise settles. A late
successful factory cannot publish readiness after cancellation; an actual factory
rejection preserves its original error. Once a callback is invoked, its actual
success or rejection is retained even after cancellation. Its resolver stays
available until actual body settlement, then expires. Cancellation and
stop deadlines never release unfinished work from the application's cleanup barrier.
Execution failures do not become startup failures or poison otherwise clean disposal.

Execution factories must yield ordinary values. The owner makes no disposal claim
for handles allocated inside them. Application resource bindings and provider
acquisition provide the ownership APIs described above. Execution resource declarations, task acquisition
and ambient context are outside this checkpoint.

## Joined child callbacks

`scope.spawn(work)` admits resource-free child work in the same execution. Children
share the existing container, context, signal, configuration and initialized service
values; no factory runs again and no authority is added. The callback is scheduled
after `spawn` returns. Each frozen scope has its own resolver and spawn lease,
which expires when that body's actual return value or promise settles. A live
child can admit grandchildren after its parent's lease has expired.

```ts
const result = await app.run(async (scope) => {
  const child = await scope.spawn((childScope) => childScope.resolve(Correlation));
  if (child.ok) return child.value;
  return "fallback";
});
```

An admitted child's promise fulfills with a shallow frozen
`ExecutionTaskOutcome<T>`: `{ ok: true, value }` after a successful subtree, or
`{ ok: false, error }` after a failed subtree. It settles only after the actual
body and all descendants finish. Ignoring, catching or returning this outcome
does not recover a failure; recovery must occur inside the failing callback.
Thus the example's fallback cannot make a failed child into a successful run.

Each own-body failure occurs once in recursive admission-tree preorder, independent
of settlement order. A single failure rejects `run` with its exact opaque payload,
including `undefined`, `false` or `0`. Multiple failures produce a fresh native
`AggregateError` with message `Execution task failures.` and the first occurrence
as `cause`. Only the owner-created aggregate and its copied `errors` array are
frozen. Caller values and errors retain identity and mutability; caller aggregates
are opaque. Explicitly throwing a child's observed error adds a new body failure,
so throwing the summary of two child failures produces three occurrences.

Expired scope, malformed callback, cancellation or deadline rejection at the spawn
call creates an observed rejected promise without admitting a child. Cancellation
between admission and scheduled invocation skips that child's body and records
its exact reason as one failure. Cancellation does not automatically end active
bodies, and body failure does not cancel siblings. Resolve access remains available
until actual body settlement; new spawn calls check cancellation and wall time.

The root run and application cleanup barrier join every admitted descendant,
including ignored children and grandchildren. Producer stop and drain precede the
join; backing flush and close follow it. A stop deadline may expire while actual
completion remains pending. Execution signal listeners and deadline timer stay
owned until the whole tree settles, even if the root body fails first, and are
then disposed once.

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
owner, its private resource journal, service composition, token contracts and configuration modules. It is also
part of `check:module-imports` and the existing validation gate. Contract-only
modules must erase completely; runtime edges are limited to the declared neutral
modules. Eight canonical standalone public artifacts have separate built-import checks. Ambient resource names are conservatively reserved even
for local bindings. This is a maintenance rule, not a sandbox for hostile code.

The private resource journal holds acquisition records, captured hooks and dependency
retention. The application owner retains admission, callback leases, startup and command
barriers, cancellation, deadlines and outcome publication. Cleanup still stops producers,
drains resources, joins admitted commands, flushes eligible resources and then closes them.
Within each provider, reservation order determines reverse cleanup order even when opens
finish in a different order. Execution initialization and entire callback-tree
settlement share the application's admitted-work barrier.

The remaining legacy owners, string keys and consumers are enumerated in
[the migration ledger](architecture/m21-legacy-callers.txt). Their continued
presence does not establish application isolation for those paths.
