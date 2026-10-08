# Infrastructure discovery

Discovery loads trusted application code at startup. Jobs and listeners now use awaited ESM imports rather than synchronous `require`. Provider startup awaits discovery before admitting HTTP traffic or starting a worker. Loading a listener module does not execute its registrar; provider boot awaits the registrar separately.

## Files and exports

Job and listener directories default to `process.cwd()/src/jobs` and `process.cwd()/src/listeners`. An absent root is optional. Other filesystem and import failures propagate. Scanning is recursive, follows deterministic lexical filename order, and ignores symlinks. Extensions are `.ts`, `.js`, `.mts` and `.mjs`; declaration, test and spec files are excluded. `index` and `register` files with these extensions are excluded to avoid importing startup orchestrators that await discovery themselves. Use `exclude` for other helper files or folders: basenames apply at any depth, relative paths apply from the selected root and use `/` separators. Imports retain their native ESM caching semantics.

A job file exports a class with a nonempty static `jobName` and a `handle` method. Framework `Job` subclasses may implement `handle` as an instance arrow field. Default and named job-class exports are supported, including re-exports. Aliases of the same class are registered once. Unrelated named helper exports are ignored when the file has a valid job export. A malformed default, a malformed named export declaring `jobName`, or a file with no job exports fails visibly. Legacy Bun CommonJS `{ default: JobClass }` remains accepted. For custom constructors or injected dependencies, use a factory manifest or register an explicit factory in `jobRegistry` before discovery.

Distinct discovered classes/factories sharing a job name fail before any registration from that batch, including across independent discovery sources. A factory already registered explicitly takes precedence over discovery. This preserves application-owned DI factories and default framework registrations. Do not mutate the registry while discovering. Module imports can have side effects; batch validation does not roll those back. Keep import-time business effects out of infrastructure modules.

Listener files have a default registrar function returning `void` or `Promise<void>`. Default re-exports and legacy CommonJS wrappers are supported; named-only registrars require an explicit manifest. Aliases of the same function are returned once. Malformed default exports fail instead of silently disappearing. Registrars may register resources and callbacks but must not perform durable business effects at startup. Providers remain responsible for registration-owned cleanup.

Module discovery requires `configureModulesDirectory(directory)` or `configureModulesManifest(modules)` before default startup. A filesystem module occupies one immediate child folder with exactly one `index.ts`, `index.js`, `index.mts` or `index.mjs`. That entrypoint must default-export its `AppModule`; a named declaration re-exported as default is supported. `exclude` skips child folder names. Missing or ambiguous entrypoints, malformed names/order/routes/provider hooks and duplicate module names fail startup. Module `order` sorts ascending (default 100), with lexical folder order breaking ties. Manifest order breaks equal-priority ties. Module providers retain their register-all/boot-all lifecycle; discovery does not run them.

## Awaited startup

```ts
registerDefaultJobs();
await discoverJobs();
const queue = createAppQueue(driver, redisUrl, failedJobs);

for (const registerListener of await discoverListeners()) {
  await registerListener();
}
```

Do not pass an async discovery function to `createAppQueue`'s synchronous `registerJobs` callback. Await discovery before constructing the queue instead. Generated providers and the framework worker entrypoint follow this order.

Concurrent loads of the same directory/exclusions or manifest share one promise. Successful empty results are cached too. A failed discovery promise is evicted, so a repaired filesystem or validation condition can be retried. Runtime ESM caching still applies: editing a module whose import already rejected may require process restart. This is startup discovery, not a hot-reload or cache-busting API. Reset helpers invalidate discovery state for tests; they do not unload ESM or unregister job factories. Pending work from an invalidated load cannot publish stale jobs or overwrite a newly configured module source. Listener registrars run once per provider boot; loading them once does not make their effects globally once-only across application lifetimes.

## Explicit manifests and bundles

```ts
import { discoverJobs } from "@getstrata/bootstrap/discoverJobs";
import { discoverListeners } from "@getstrata/bootstrap/discoverListeners";
import { configureModulesManifest } from "@getstrata/bootstrap/discoverModules";
import NotificationJob from "./jobs/NotificationJob.ts";
import registerListeners from "./listeners/notifications.ts";
import commerceModule from "./modules/commerce/index.ts";

configureModulesManifest([commerceModule]);
await discoverJobs({
  manifest: [NotificationJob, {
    name: "application.injected-job",
    create: () => new InjectedJob(container.resolve(serviceToken)),
  }],
});
const registrars = await discoverListeners({ manifest: [registerListeners] });
for (const register of registrars) await register();
```

Use static imports so the bundler includes modules. Factory closures retain application DI decisions and are not invoked during discovery. A factory must return a valid job when the worker invokes it. Configure module manifests before `createAppContext()`; pass the job/listener manifests from your provider startup rather than duplicating their registration in both bootstrap and providers. A manifest bypasses filesystem scanning; keep its identity stable for a given startup. Explicit `modulesDir` overrides a configured module manifest for that call. Calling `configureModulesDirectory` clears a configured manifest.

## Source compatibility and release

`discoverJobs()` now returns `Promise<string[]>` and `discoverListeners()` returns `Promise<ListenerRegistrar[]>`. Existing synchronous custom callers must migrate to `await`; this is a public source compatibility change, not a patch-only fix. Previously ignored malformed files also become startup errors. Release this contract change through the agreed breaking-change/prerelease process and update application callers before stable promotion. No package version is bumped by this PR.

Generated entrypoints and all checked-in example apps adopt the awaited shape. Models keep their separate existing `discoverModels`/`bootModels` contracts; their constructor and repository semantics differ from job/listener/module discovery. Tests cover top-level await, deterministic nested exports, malformed/duplicate diagnostics, failed-load retry, stale pending loads after reset, custom factories, async registrar boot, actual Bun bundles and the packed-package TypeScript matrix.
