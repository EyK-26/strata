# Infrastructure discovery

Discovery loads trusted application code at startup. Jobs and listeners now use awaited ESM imports rather than synchronous `require`. Provider startup awaits discovery before admitting HTTP traffic or starting a worker. Listener discovery collects inert service and repository-effect declarations before application construction; it does not run callbacks.

## Files and exports

Job and listener directories default to `process.cwd()/src/jobs` and `process.cwd()/src/listeners`. An absent root is optional. Other filesystem and import failures propagate. Scanning is recursive, follows deterministic lexical filename order, and ignores symlinks. Extensions are `.ts`, `.js`, `.mts` and `.mjs`; declaration, test and spec files are excluded. `index` and `register` files with these extensions are excluded to avoid importing startup orchestrators that await discovery themselves. Use `exclude` for other helper files or folders: basenames apply at any depth, relative paths apply from the selected root and use `/` separators. Imports retain their native ESM caching semantics.

A job file exports a class with a nonempty static `jobName` and a `handle` method. Framework `Job` subclasses may implement `handle` as an instance arrow field. Default and named job-class exports are supported, including re-exports. Aliases of the same class are registered once. Unrelated named helper exports are ignored when the file has a valid job export. A malformed default, a malformed named export declaring `jobName`, or a file with no job exports fails visibly. Legacy Bun CommonJS `{ default: JobClass }` remains accepted. For custom constructors or injected dependencies, use a factory manifest or register an explicit factory in the application-owned `JobRegistry` before discovery.

Distinct discovered classes/factories sharing a job name fail before any registration from that batch, including across independent discovery sources using the same registry. A factory already registered explicitly takes precedence over discovery. This preserves application-owned DI factories and default framework registrations. Do not mutate the registry while discovering. Module imports can have side effects; batch validation does not roll those back. Keep import-time business effects out of infrastructure modules.

For ordinary declarations, use `defineModelListener` or `defineEventListener` from
`@getstrata/bootstrap/discoverListeners`. These helpers retain explicit ownership
and dependency typing without requiring a handwritten service/effect pair.

Listener files default-export a `ListenerDeclarations` object with own array-valued `services` and `repositoryEffects` fields. Default re-exports and legacy CommonJS wrappers are supported; use an explicit manifest for declarations without a default export. Aliases of the same object are returned once. Discovery freezes copies of the declaration arrays and result array. Registrar callbacks and malformed exports are rejected. Assemble the returned services and repository effects into the application's database bindings before opening runtime resources; discovery itself does not register listeners or own their cleanup.

Module discovery requires an explicit `ensureModulesLoaded({ modulesDir: directory })` or `ensureModulesLoaded({ manifest: modules })` call. Retain its immutable result and pass it to route builders and `collectProviders(modules)`; no process-global module projection or configuration exists. A filesystem module occupies one immediate child folder with exactly one `index.ts`, `index.js`, `index.mts` or `index.mjs`. That entrypoint must default-export its `AppModule`; a named declaration re-exported as default is supported. `exclude` skips child folder names. Missing or ambiguous entrypoints, malformed names/order/routes/provider hooks and duplicate module names fail startup. Module `order` sorts ascending (default 100), with lexical folder order breaking ties. Manifest order breaks equal-priority ties. Module providers retain their register-all/boot-all lifecycle; discovery does not run them.

## Awaited startup

```ts
import { registerDefaultJobs } from "@getstrata/bootstrap";
import { discoverJobs } from "@getstrata/bootstrap/discoverJobs";
import { discoverListeners } from "@getstrata/bootstrap/discoverListeners";
import { createAppQueue, type QueueServices } from "@getstrata/core/queue/createAppQueue";
import { JobRegistry } from "@getstrata/core/queue/jobRegistry";

async function assembleQueue(
  driver: "sync" | "async" | "redis",
  redisUrl: string | undefined,
  failedJobs: QueueServices,
) {
  const registry = new JobRegistry();
  registerDefaultJobs(registry);
  await discoverJobs(registry);
  return { registry, queue: createAppQueue(driver, redisUrl, failedJobs, registry) };
}

const declarations = await discoverListeners();
const listenerServices = declarations.flatMap(entry => entry.services);
const listenerEffects = declarations.flatMap(entry => entry.repositoryEffects);
// Include these in the application's database bindings before runtime construction.
```

Await job discovery before constructing the queue. `createAppQueue` requires the same owned registry and has no `registerJobs` callback. Queue producers and workers must use registries with matching job names and factories; do not share a mutable registry across independent applications.

Job discovery shares pending/successful loads only within the supplied registry; failures are evicted for retry. Listener discovery performs a fresh collection on each call and has no shared discovery cache. Native ESM caching still applies to imported modules: this is startup discovery, not a hot-reload or cache-busting API. Retain the collected declarations for application assembly.

## Explicit manifests and bundles

```ts
import { discoverJobs } from "@getstrata/bootstrap/discoverJobs";
import { discoverListeners } from "@getstrata/bootstrap/discoverListeners";
import { ensureModulesLoaded } from "@getstrata/bootstrap/discoverModules";
import NotificationJob from "./jobs/NotificationJob.ts";
import notificationDeclarations from "./listeners/notifications.ts";
import { JobRegistry } from "@getstrata/core/queue/jobRegistry";
import commerceModule from "./modules/commerce/index.ts";

const modules = await ensureModulesLoaded({ manifest: [commerceModule] });
const registry = new JobRegistry();
await discoverJobs(registry, {
  manifest: [NotificationJob],
});
const declarations = await discoverListeners({ manifest: [notificationDeclarations] });
```

Use static imports so the bundler includes modules. Factory closures retain application DI decisions and are not invoked during discovery. A factory must return a valid job when the worker invokes it. For custom composition, pass the collected providers to `createApplicationContext(providers, { definition, connection, ... })`; generated apps assemble their own provider list. pass job manifests to discovery with the owned registry and assemble listener declarations once into the application graph. A manifest bypasses filesystem scanning. For repeated module loads within one application, use `const discovery = createModuleDiscovery(options)` and `await discovery.load()`. This owner captures the source directory, manifest array and exclusions, shares one pending/successful result, and evicts failed attempts for retry. Independent owners never mutate each other’s results. One-shot `ensureModulesLoaded(options)` has no shared cache.

## Source compatibility and release

`discoverJobs(registry, options)` returns `Promise<string[]>` and `discoverListeners(options)` returns `Promise<readonly ListenerDeclarations[]>`. The 3.x API requires awaited discovery, an owned job registry and inert listener declarations. The removed synchronous/global registration contracts are not compatibility fallbacks. Malformed files fail startup. See the [migration guide](architecture/target-api-migration.md) for the supported composition contracts.

Generated entrypoints adopt awaited infrastructure discovery. Models use explicit
`defineRepository`/`defineModel` definitions registered with the application's
`createDatabaseBindings`; the former global `discoverModels`/`bootModels` APIs are
removed. Tests cover trusted imports, deterministic nested exports, malformed and
duplicate diagnostics, failed-load retry, custom factories, inert listener
declarations, actual Bun bundles and packed-package contracts.
