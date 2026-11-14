# Authoring application providers

Use `defineProvider` to group service declarations with startup work. It produces the same `ProviderDefinition` accepted by `createApplication` and `createApplicationContext`'s `definition.providers`.

```ts
import { createServiceToken } from "@getstrata/core/contracts/token";
import { createApplication, defineProvider, service } from "@getstrata/core/runtime/application";

const GREETING = createServiceToken<{ text: string }>("greeting");
const greetingProvider = defineProvider({
  name: "app.greeting",
  services: [service(GREETING, {
    lifetime: "application",
    dependencies: [],
    create: () => ({ text: "Hello" }),
  })],
  setup(scope) {
    console.log(scope.resolve(GREETING).text);
  },
  boot(scope) {
    // All provider setup hooks have completed here.
    console.log(`Ready to start transports for ${scope.applicationId}`);
  },
});

const app = createApplication({ providers: [greetingProvider] });
await app.start();
await app.stop();
```

Bindings are declarations, not imperative registration calls. The existing graph compiles all top-level and provider bindings together when constructing the application, validates duplicates, dependency cycles and lifetimes, and initializes application bindings before provider setup. `overrides` keeps its existing explicit replacement rules. Provider arrays and hooks are snapshotted; service payload objects remain caller-owned.

Startup runs all provider `setup` hooks in `requires` order, then all provider `boot` hooks in that order, then transports. A failed setup skips every boot hook. A failed boot skips transports. Transport definitions may also declare a boot hook, which follows that transport's setup. `requires` orders startup hooks; service `dependencies` separately declares the typed service graph. Neither ordering mechanism introduces lazy resolution or request-time reflection.

Each hook receives a fresh leased `ProviderScope`. Its `resolve` and `acquire` access expires when that hook settles. Use `resourceService` for owned service bindings or `scope.acquire` for startup resources; cleanup, cancellation, retained ownership and shutdown ordering stay with the existing application owner. Never open resources inside a pure service factory. Long-running servers and workers belong in transports. Resources acquired by setup and boot share the provider's existing resource group.

The generated starter uses `defineProvider({ name: "starter.services", services: [...] })` for its service assembly. Existing plain `ProviderDefinition` objects, top-level `services`, `overrides`, resource declarations and legacy bootstrap adapters remain supported. The helper does not replace the legacy `ServiceProvider` register/boot adapter contract.
