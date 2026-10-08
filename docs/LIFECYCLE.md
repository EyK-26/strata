# Graceful lifecycle

Generated HTTP, queue worker and scheduler entrypoints use `LifecycleCoordinator` from `@getstrata/core/lifecycle/gracefulShutdown`. Existing custom entrypoints need to adopt it explicitly. Upgrading packages alone does not replace application-owned signal handlers.

Shutdown is one shared promise, including repeated signals and concurrent manual calls. Phases run in this order: stop admission, drain admitted work, flush telemetry, close infrastructure. Callbacks run sequentially in registration order within each phase. The coordinator is one-shot; create another for another application lifetime.

```ts
import {
  LifecycleCoordinator,
  installGracefulShutdownSignals,
} from "@getstrata/core/lifecycle/gracefulShutdown";
import { createWebServer } from "@getstrata/bootstrap/web/server";

const lifecycle = new LifecycleCoordinator();
const server = createWebServer({ port: 3000, routes, lifecycle });
lifecycle.register("providers:drain", () => context.drain(), "drain");
lifecycle.register("providers:flush", () => context.flush(), "flush");
lifecycle.register("providers:close", () => context.dispose(), "close");
lifecycle.register("database", closeDatabase, "close");
const uninstall = installGracefulShutdownSignals(undefined, lifecycle);
// In tests or embedding: await lifecycle.shutdown("MANUAL"); uninstall();
```

`createWebServer` stops admission before awaiting Bun's connection drain and tracks async handlers independently. A disconnected client can leave a business transaction running; that handler must complete before infrastructure closes. New framework dispatch is rejected with HTTP 503 during shutdown. Bun may reject connections before framework dispatch. Streaming responses and WebSockets can keep connections alive; close application-owned sockets cooperatively in a stop hook or the deadline forces transport closure. Pass native request cancellation to operations that support it. A forced socket close cannot cancel arbitrary JavaScript work.

Providers register `onCleanup(handler, "drain" | "flush" | "close")`; omitted phase means close. Each provider phase runs once in reverse resource acquisition order. `context.dispose()` also drains and flushes when called directly. A failed drain prevents resource closure. Flush failure is reported but remaining cleanup proceeds. Applications with a custom telemetry exporter register its flush in the flush phase; this release does not replace the tracing implementation.

The queue CLI stops reserving jobs and awaits the active handler and its acknowledgement before cleanup. Its `drain` and `flush` options allow provider phases to run before `close`. The async in-process queue owns scheduled callbacks and drains child jobs before its provider closes. It remains ephemeral: use Redis for recoverable delivery. Redis jobs and SQL outbox deliveries remain at least once; effects require replay-safe handlers. On forced worker termination, unacknowledged Redis reservations remain eligible for recovery.

The scheduler CLI and in-process cron stop admitting due tasks and await the current effect. Shutdown does not add distributed scheduler ownership. Scheduled effects must remain idempotent. Custom outbox runners or other background work register stop, drain and force hooks with the same coordinator. For `SqlOutbox.work({ signal })`, own an AbortController, abort it in stop, and await the runner promise in drain. Finish or safely interrupt admitted effects before closing the database. Register producers' drains before consumers they can enqueue into.

`SHUTDOWN_TIMEOUT_MS` sets the total shutdown budget (default 30000); a constructor `timeoutMs` overrides it. Values must be integers from 1 through 2147483647 milliseconds, within the native timer range. At the deadline the shared AbortSignal is aborted, force hooks are invoked once and shutdown returns a failed result. Stop/drain failures also abort and force, skipping normal flush/close rather than closing infrastructure beneath live work. Flush/close failures are collected while remaining safe cleanup continues. Force callbacks must be prompt and observe the signal; the coordinator cannot await an uncooperative callback beyond its budget. JavaScript timers cannot interrupt a synchronously blocked event loop: configure an external supervisor kill deadline beyond the application's grace period.

Programmatic shutdown returns `{ successful, timedOut, errors }` without exiting the process. Installed signal handlers exit 0 only after successful shutdown, otherwise 1. Installation returns an uninstall function. Legacy global `registerShutdownHandler` and `runGracefulShutdown` remain available; legacy registrations default to close. Move admission and work hooks to explicit phases. CLI invocations own independent coordinators; inject `lifecycle` for programmatic control rather than assuming the legacy global coordinator owns a CLI invocation. Root `App.shutdown()` coordinates resources; its existing `stop()` remains transport-only.

Regression coverage includes connected and disconnected HTTP requests committing through restricted-role Postgres RLS, actual Redis reservation acknowledgement before closure, async child jobs, scheduler admission cancellation, provider phase ordering and failures, repeated signals, and a real process exceeding its hard deadline. Bun's native connection semantics are documented in [Server.stop](https://bun.sh/reference/bun/Server/stop).
