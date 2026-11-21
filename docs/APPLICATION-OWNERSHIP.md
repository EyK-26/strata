# Application and execution ownership

Generated applications normally use `defineApp` from
`@getstrata/bootstrap/application`. Lower-level integrations can use
`createApplication` directly:

```ts
import { createApplication } from '@getstrata/core/runtime/application';

const app = createApplication({
	config: { applicationName: 'orders' },
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

Construction validates declarations without opening resources. `start()` initializes
application services and providers. `run()` admits an owned execution with its own
services, identity and cancellation. `stop()` closes admission, drains work and
releases resources in dependency order. An application cannot restart after stopping.

## Services and providers

Use `createServiceToken` from `@getstrata/core/contracts/token` and `service` or
`valueService` from `@getstrata/core/contracts/services`. Import a token constant
where needed; recreating its diagnostic name does not recreate its identity.
Factories declare their dependencies and lifetime explicitly:

- Application services may retain stable configuration and infrastructure capabilities.
- Execution services may retain their own request identity, scoped policy or database
  session. They must not escape that execution or become singleton dependencies.
- Controllers receive narrow capabilities. Resolve dependencies in composition code;
  do not pass the container or the entire bootstrap context into business code.
- Providers declare dependencies and register before boot. See
  [application providers](application-providers.md).

The service graph validates missing dependencies, duplicates, cycles and invalid
lifetime edges before factories run. Treat configuration as an immutable startup
snapshot. Read environment variables in composition, not on every request.

## Persistence, tasks and cleanup

Select models through the execution's database session. Use the transaction's own
session inside a transaction; don't retain it or launch detached work that outlives
it. After-commit effects and cache invalidation must not fire on rollback. See
[database sessions](DATABASE-SESSIONS.md) and [database usage](DATABASE.md).

Resource acquisition records ownership before opening the resource. Adapters must
report whether failed acquisition cleaned up, acquired nothing or left an unknown
obligation. A thrown error alone is not proof of cleanup. Use the owned task/resource
APIs for child work; do not detach asynchronous operations from their parent scope.

An abort signal or deadline does not prove an underlying operation stopped. Inspect
stop results and eventual completion when work cannot settle within the shutdown
budget. Do not await an operation's own parent completion or call application stop
from a callback whose completion stop is waiting for.

For extension interfaces, read the public runtime and contract types rather than
copying internal registries or lifecycle state machines into an application:

- `@getstrata/core/runtime/application`
- `@getstrata/core/contracts/application`
- `@getstrata/core/contracts/services`
- `@getstrata/core/contracts/executionContext`
- `@getstrata/core/contracts/executionOperations`

See [lifecycle](LIFECYCLE.md) for server shutdown and
[production](PRODUCTION.md) for deployment concerns.
