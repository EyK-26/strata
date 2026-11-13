import type { Application } from "@getstrata/core/contracts/application";
import type { OutboxWorkerTransport } from "@getstrata/core/events/outbox";
import {
  installGracefulShutdownSignals,
  LifecycleCoordinator,
} from "@getstrata/core/lifecycle/gracefulShutdown";

interface OutboxWorkerApplication {
  readonly application: Application;
  readonly outboxWorker: OutboxWorkerTransport;
}
type OutboxWorkerBoot = () => OutboxWorkerApplication | Promise<OutboxWorkerApplication>;
interface OutboxWorkerOptions {
  readonly boot: OutboxWorkerBoot;
  readonly lifecycle?: LifecycleCoordinator;
}

async function runOutboxWorkerCommand(options: OutboxWorkerOptions): Promise<void> {
  if (
    typeof options.boot !== "function" ||
    ["listeners", "outbox", "close", "flush", "drain"].some((key) => Object.hasOwn(options, key))
  )
    throw new TypeError("Outbox workers require boot() returning an application-owned transport.");
  const lifecycle = options.lifecycle ?? new LifecycleCoordinator();
  if (lifecycle.isShuttingDown) throw new Error("Cannot start an outbox worker during shutdown.");
  let application: OutboxWorkerApplication | undefined;
  let running: Promise<void> | undefined;
  let booting: Promise<void> | undefined;
  let stopping = false;
  const name = `outbox:${crypto.randomUUID()}`;
  lifecycle.register(
    `${name}:stop`,
    async () => {
      stopping = true;
      // The signal lifecycle determines process exit status even when boot has
      // already rejected. Retain that exact failure in every shutdown ordering.
      await booting;
      if (!application) return;
      const result = await application.application.stop({ reason: "OUTBOX_SHUTDOWN" });
      if (!result.successful) {
        const failures = result.snapshot.errors.map((entry) => entry.error);
        throw new AggregateError(
          failures.length
            ? failures
            : [new Error("Outbox application shutdown was not confirmed clean.")],
          "Outbox application shutdown failed.",
        );
      }
    },
    "stop",
  );
  lifecycle.register(
    `${name}:drain`,
    async () => {
      await booting?.catch(() => {});
      await running?.catch(() => {});
      if (running) console.log("[outbox:work] Polling stopped.");
    },
    "drain",
  );
  const uninstall = installGracefulShutdownSignals(undefined, lifecycle);
  let failure: { error: unknown } | undefined;
  try {
    booting = (async () => {
      application = await options.boot();
    })();
    await booting;
    if (!application?.application || typeof application.application.stop !== "function")
      throw new TypeError("Outbox boot must return its application.");
    if (!application.outboxWorker || typeof application.outboxWorker.start !== "function")
      throw new TypeError("Outbox boot must return its application-owned outboxWorker.");
    if (!stopping && !lifecycle.isShuttingDown) {
      console.log(
        "[outbox:work] Starting SQL outbox polling; idle until deliveries are available.",
      );
      running = application.outboxWorker.start();
      await running;
    }
  } catch (error) {
    failure = { error };
  }
  try {
    const result = await lifecycle.shutdown("OUTBOX_FINISHED");
    if (!result.successful)
      throw new AggregateError(
        [...(failure ? [failure.error] : []), ...result.errors.map((entry) => entry.error)],
        "Outbox startup/runtime or shutdown failed.",
      );
    if (failure) throw failure.error;
  } finally {
    uninstall();
  }
}

export type { OutboxWorkerApplication, OutboxWorkerBoot, OutboxWorkerOptions };
export { runOutboxWorkerCommand };
