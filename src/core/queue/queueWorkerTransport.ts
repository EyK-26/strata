import type { TransportDefinition } from "../contracts/application";
import type { JobRegistry } from "./jobRegistry";
import { createQueueWorker } from "./publicQueue";
import {
  type QueueRetryPolicy,
  type QueueRuntimeConfig,
  resolveQueueConfig,
  resolveQueueRuntimeConfig,
  snapshotQueueRetryPolicy,
  snapshotQueueRuntimeConfig,
} from "./queueConfig";
import type { QueueServices } from "./queueServices";

interface QueueWorkerAdapter {
  requestStop(): void;
  run(): Promise<void>;
  processNext?(): Promise<boolean>;
  close(): void | Promise<void>;
}
interface QueueWorkerTransport {
  readonly transport: TransportDefinition;
  /** Begin polling after the owning application is ready. Actual settlement is retained for drain. */
  start(): Promise<void>;
  /** Admit one bounded poll with the same transport owner and drain barrier. */
  processNext(): Promise<boolean>;
}
function createQueueWorkerTransport(options: {
  readonly redisUrl: string;
  readonly registry: JobRegistry | (() => JobRegistry);
  readonly queueServices: Pick<QueueServices, "recordFailure" | "runAttempt">;
  readonly name?: string;
  readonly runtime?: QueueRuntimeConfig;
  readonly retryPolicy?: QueueRetryPolicy;
  readonly createWorker?: (
    redisUrl: string,
    services: Pick<QueueServices, "recordFailure" | "runAttempt">,
    registry: JobRegistry,
  ) => QueueWorkerAdapter;
}): QueueWorkerTransport {
  const runtime = snapshotQueueRuntimeConfig(options.runtime ?? resolveQueueRuntimeConfig());
  const retryPolicy = snapshotQueueRetryPolicy(options.retryPolicy ?? resolveQueueConfig());
  const { redisUrl, queueServices } = options;
  const registrySource = options.registry;
  const createWorker =
    options.createWorker ??
    ((url, services, registry) =>
      createQueueWorker(url, services, registry, { runtime, retryPolicy }));
  const name = options.name ?? "queue.worker";
  let worker: QueueWorkerAdapter | undefined;
  let running: Promise<void> | undefined;
  let stopping = false;
  let acquired = false;
  const active = new Set<Promise<unknown>>();
  function track<T>(promise: Promise<T>): Promise<T> {
    active.add(promise);
    void promise.finally(() => active.delete(promise)).catch(() => {});
    return promise;
  }
  return Object.freeze<QueueWorkerTransport>({
    transport: {
      name,
      async setup(scope) {
        await scope.acquire({
          name,
          open: () => {
            try {
              worker = createWorker(
                redisUrl,
                queueServices,
                typeof registrySource === "function" ? registrySource() : registrySource,
              );
              acquired = true;
              return { ok: true, value: worker };
            } catch (error) {
              // A throwing custom factory may have acquired native state without returning its handle.
              return { ok: false, error, disposition: "unknown" };
            }
          },
          stop: (value) => {
            stopping = true;
            value.requestStop();
          },
          drain: async () => {
            while (active.size) await Promise.allSettled([...active]);
          },
          close: async (value) => {
            await value.close();
            acquired = false;
          },
        });
      },
    },
    start() {
      if (running) return running;
      if (!worker || !acquired || stopping || active.size)
        return Promise.reject(new Error("Queue worker is not available for admission."));
      const selected = worker;
      running = track(Promise.resolve().then(() => selected.run()));
      void running.catch(() => {});
      return running;
    },
    processNext() {
      if (!worker || !acquired || stopping || running || active.size)
        return Promise.reject(new Error("Queue worker is not available for bounded admission."));
      const selected = worker;
      if (!selected.processNext)
        return Promise.reject(new Error("Queue worker does not support bounded polling."));
      const poll = selected.processNext.bind(selected);
      return track(Promise.resolve().then(() => poll()));
    },
  });
}

export type { QueueWorkerAdapter, QueueWorkerTransport };
export { createQueueWorkerTransport };
