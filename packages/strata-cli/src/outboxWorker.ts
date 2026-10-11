import type { DurableListener } from "@getstrata/core/events/outbox";
import { SqlOutbox } from "@getstrata/core/events/outbox";
import {
  installGracefulShutdownSignals,
  LifecycleCoordinator,
} from "@getstrata/core/lifecycle/gracefulShutdown";

type OutboxWorkerBoot = () => unknown | Promise<unknown>;
type OutboxWorkerClose = () => unknown | Promise<unknown>;

async function runOutboxWorkerCommand(options: {
  boot: OutboxWorkerBoot;
  listeners: readonly DurableListener[];
  close?: OutboxWorkerClose;
  flush?: OutboxWorkerClose;
  drain?: OutboxWorkerClose;
  lifecycle?: LifecycleCoordinator;
}): Promise<void> {
  const lifecycle = options.lifecycle ?? new LifecycleCoordinator();
  if (lifecycle.isShuttingDown) throw new Error("Cannot start an outbox worker during shutdown.");
  const admission = new AbortController();
  let running: Promise<void> | undefined;
  let booting: Promise<unknown> | undefined;
  let stopping = false;
  const name = `outbox:${crypto.randomUUID()}`;
  lifecycle.register(
    `${name}:stop`,
    () => {
      stopping = true;
      admission.abort();
    },
    "stop",
  );
  lifecycle.register(
    `${name}:drain`,
    async () => {
      await booting?.catch(() => {});
      await running?.catch(() => {});
      await options.drain?.();
    },
    "drain",
  );
  lifecycle.register(
    `${name}:flush`,
    async () => {
      await options.flush?.();
    },
    "flush",
  );
  lifecycle.register(
    `${name}:close`,
    async () => {
      await options.close?.();
    },
    "close",
  );
  const uninstall = installGracefulShutdownSignals(undefined, lifecycle);
  let failure: unknown;
  let failed = false;
  try {
    booting = Promise.resolve(options.boot());
    await booting;
    if (!stopping && !lifecycle.isShuttingDown) {
      const outbox = new SqlOutbox({ listeners: options.listeners });
      running = outbox.work({ signal: admission.signal });
      await running;
    }
  } catch (error) {
    failed = true;
    failure = error;
  }
  const result = await lifecycle.shutdown("OUTBOX_FINISHED");
  uninstall();
  if (!result.successful)
    throw new AggregateError(
      [...(failed ? [failure] : []), ...result.errors.map((entry) => entry.error)],
      "Outbox startup/runtime or shutdown failed.",
    );
  if (failed) throw failure;
}

export type { OutboxWorkerBoot, OutboxWorkerClose };
export { runOutboxWorkerCommand };
