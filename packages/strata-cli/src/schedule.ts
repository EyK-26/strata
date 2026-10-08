import {
  installGracefulShutdownSignals,
  LifecycleCoordinator,
} from "@getstrata/core/lifecycle/gracefulShutdown";
import { appSchedule, runDueScheduledTasks } from "@getstrata/core/scheduler/schedule";

type LoadAppSchedule = () => void | Promise<void>;
type CloseScheduledApp = () => void | Promise<void>;

function createScheduleRunCommand(
  loadSchedule: LoadAppSchedule,
  close?: CloseScheduledApp,
  options: {
    lifecycle?: LifecycleCoordinator;
    flush?: CloseScheduledApp;
    drain?: CloseScheduledApp;
  } = {},
) {
  return async function scheduleRunCommand(): Promise<void> {
    const lifecycle = options.lifecycle ?? new LifecycleCoordinator();
    if (lifecycle.isShuttingDown) throw new Error("Cannot start scheduling during shutdown.");
    const admission = new AbortController();
    let stopping = false;
    let execution: Promise<void> | undefined;
    const name = `scheduler:${crypto.randomUUID()}`;
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
        await execution?.catch(() => {});
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
        await close?.();
      },
      "close",
    );
    const uninstall = installGracefulShutdownSignals(undefined, lifecycle);
    let failed = false;
    let failure: unknown;
    try {
      execution = (async () => {
        await loadSchedule();
        if (stopping) return;
        const due = appSchedule.dueTasks();
        if (due.length === 0) console.log("No scheduled tasks due.");
        else {
          for (const task of due) console.log(`Running scheduled task: ${task.name}`);
          await runDueScheduledTasks(appSchedule, new Date(), { signal: admission.signal });
        }
      })();
      await execution;
    } catch (error) {
      failed = true;
      failure = error;
    }
    const result = await lifecycle.shutdown("SCHEDULE_FINISHED");
    uninstall();
    if (!result.successful)
      throw new AggregateError(
        [...(failed ? [failure] : []), ...result.errors.map((entry) => entry.error)],
        "Scheduler startup/runtime or shutdown failed.",
      );
    if (failed) throw failure;
  };
}

export type { CloseScheduledApp, LoadAppSchedule };
export { createScheduleRunCommand };
