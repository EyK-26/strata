# Graceful lifecycle

Generated HTTP, queue worker and scheduler entrypoints use `LifecycleCoordinator` from `@getstrata/core/lifecycle/gracefulShutdown`. Existing custom entrypoints need to adopt it explicitly. Upgrading packages alone does not replace application-owned signal handlers.

The application owner performs shutdown in this order: stop admission, drain admitted work, flush telemetry, close infrastructure. Repeated application stop calls share shutdown work. The signal coordinator is a one-shot adapter around that owner; create another for another application lifetime. Its own callbacks run sequentially in registration order within each phase.

```ts
import {
  LifecycleCoordinator,
  installGracefulShutdownSignals,
} from "@getstrata/core/lifecycle/gracefulShutdown";
import { createAppServer } from "./createApp.ts";

// In the generated src/bootstrap directory: HTTP is declared before startup.
const app = await createAppServer();
const lifecycle = new LifecycleCoordinator();
lifecycle.register("application", async ({ reason }) => {
  const result = await app.application.stop({ reason });
  if (!result.successful) throw new Error("Application shutdown is incomplete.");
}, "stop");
const uninstall = installGracefulShutdownSignals(undefined, lifecycle);
// In tests or embedding: await lifecycle.shutdown("MANUAL"); uninstall();
```

The generated `webServerResource` transport stops admission before awaiting Bun's connection drain and tracks async handlers independently. A disconnected client can leave a business transaction running; that handler must complete before infrastructure closes. New framework dispatch is rejected with HTTP 503 during shutdown. Bun may reject connections before framework dispatch. Streaming responses and WebSockets can keep connections alive; close application-owned sockets cooperatively in a stop hook or the deadline forces transport closure. Pass native request cancellation to operations that support it. A forced socket close cannot cancel arbitrary JavaScript work.

Providers register `onCleanup(handler, "drain" | "flush" | "close")`; omitted phase means close. Each provider phase runs once in reverse resource acquisition order. Application stop owns these phases and database closure; do not separately call `context.dispose()` and manually close its database. A failed drain prevents resource closure. Flush failure is reported but remaining cleanup proceeds. Generated and default core provider lists create an application-owned tracing runtime, which flushes in this phase and shuts down in close. Applications with an explicit custom telemetry runtime register its flush in the flush phase and shutdown in close. See [TRACING.md](TRACING.md).

The queue CLI stops reserving jobs and awaits the active handler and its acknowledgement before cleanup. Its application owns provider drain, flush and close phases. The async in-process queue owns scheduled callbacks and drains child jobs before its provider closes. It remains ephemeral: use Redis for recoverable delivery. Redis jobs and SQL outbox deliveries remain at least once; effects require replay-safe handlers. On forced worker termination, unacknowledged Redis reservations remain eligible for recovery.

Redis worker `run()` loops retire a native connection rejected with `ERR_REDIS_CONNECTION_CLOSED`, wait 250ms and resume normal polling with a fresh connection. Streams consumer-group initialization is repeated idempotently; reservation/retry records remain authoritative. The failed Redis command is never automatically replayed: loss around an acknowledgement may repeat the handler after normal ownership expiry. Direct `processNext()` calls still report the error to their caller. ACL, authentication, protocol and other errors remain fatal rather than being silently retried. Explicit worker closure is terminal, including during backoff. This does not guarantee Redis data durability, successful effects during an outage or recovery of a synchronously blocked event loop.

The scheduler CLI and in-process cron stop admitting due tasks and await the current effect. Shutdown does not add distributed scheduler ownership. Scheduled effects must remain idempotent. Custom outbox runners or other background work declare resource stop/drain hooks with the same application owner before startup. For a custom `SqlOutbox.work({ signal })` runner, own an AbortController, abort it in stop, and await the runner promise in drain; generated apps instead declare `createOutboxWorkerTransport` before startup. Finish or safely interrupt admitted effects before closing the database. Register producers' drains before consumers they can enqueue into.

`SHUTDOWN_TIMEOUT_MS` sets the signal coordinator budget (default 30000); a coordinator constructor `timeoutMs` overrides it. The application owner has its own `shutdownTimeoutMs` definition option; configure the owner and external signal/supervisor budgets together. Values must be integers from 1 through 2147483647 milliseconds, within the native timer range. At the deadline the shared AbortSignal is aborted, force hooks are invoked once and shutdown returns a failed result. Stop/drain failures also abort and force, skipping normal flush/close rather than closing infrastructure beneath live work. Flush/close failures are collected while remaining safe cleanup continues. Force callbacks must be prompt and observe the signal; the coordinator cannot await an uncooperative callback beyond its budget. JavaScript timers cannot interrupt a synchronously blocked event loop: configure an external supervisor kill deadline beyond the application's grace period.

Programmatic `lifecycle.shutdown()` returns `{ successful, timedOut, errors }` without exiting the process. `application.stop()` returns `{ successful, timedOut, snapshot }`; inspect the snapshot for retained resources and cleanup errors. Installed signal handlers exit 0 only after successful shutdown, otherwise 1. Installation returns an uninstall function. Every registration and shutdown targets an explicit `LifecycleCoordinator`; process-wide registration, shutdown and reset helpers have been removed. `installGracefulShutdownSignals(signals, lifecycle)` requires the owner and returns its uninstall function. Move admission and work hooks to explicit phases. CLI invocations own independent coordinators; inject `lifecycle` for programmatic control. Root `App.shutdown()` and `App.stop()` both stop the owned application.

Regression coverage includes connected and disconnected HTTP requests committing through restricted-role Postgres RLS, actual Redis reservation acknowledgement before closure, async child jobs, scheduler admission cancellation, provider phase ordering and failures, repeated signals, and a real process exceeding its hard deadline. Bun's native connection semantics are documented in [Server.stop](https://bun.sh/reference/bun/Server/stop).

Scheduled handlers retain renewable ownership while draining; only lease loss aborts their context signal. See [SCHEDULER.md](SCHEDULER.md) for coordination and replay contracts.
