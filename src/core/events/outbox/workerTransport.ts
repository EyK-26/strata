import { assertServiceToken, type ServiceToken } from "@getstrata/core/contracts/token";
import type { TransportDefinition } from "../../contracts/application";
import type { SqlOutbox } from "./index";

// Source-private transport port; never re-exported by the public outbox entrypoint.
export const workerApplicationShutdown: unique symbol = Symbol(
  "outbox.worker.application.shutdown",
);

interface OutboxWorkerTransport {
  readonly transport: TransportDefinition;
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly completion: Promise<void>;
}
/** One application resource owns actual polling; SQL/pins remain in the canonical graph. */
function createOutboxWorkerTransport(
  token: ServiceToken<SqlOutbox>,
  options: Readonly<{ pollMs?: number; name?: string }> = {},
): OutboxWorkerTransport {
  assertServiceToken(token);
  const name = options.name ?? "outbox.worker";
  const pollMs = options.pollMs ?? 1000;
  if (!name.trim() || !Number.isSafeInteger(pollMs) || pollMs < 1)
    throw new TypeError("Invalid outbox worker configuration.");
  const controller = new AbortController();
  // Normalize only this adapter's own requested stop, including duplicate kernel
  // occurrences. An aborted signal does not excuse independent operational errors.
  const stopped = new Error("Outbox worker stopped.");
  const expectedStop = (error: unknown): boolean =>
    error === stopped ||
    (applicationShutdown?.aborted === true && error === applicationShutdown.reason) ||
    (error instanceof AggregateError &&
      error.errors.length > 0 &&
      error.errors.every(expectedStop));
  let applicationShutdown: AbortSignal | undefined;
  let outbox: SqlOutbox | undefined;
  let acquired = false;
  let running: Promise<void> | undefined;
  let settled = false;
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const completion = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void completion.catch(() => {});
  function complete(error?: { value: unknown }): void {
    if (settled) return;
    settled = true;
    if (error) reject(error.value);
    else resolve();
  }
  async function stop(): Promise<void> {
    controller.abort(stopped);
    if (running) await running;
    else complete();
  }
  return Object.freeze<OutboxWorkerTransport>({
    completion,
    transport: {
      name,
      async setup(scope) {
        const selected = scope.resolve(token);
        applicationShutdown = scope.signal;
        await scope.acquire({
          name,
          open: () => {
            outbox = selected;
            acquired = true;
            return { ok: true, value: selected };
          },
          stop: () => {
            controller.abort(stopped);
          },
          drain: stop,
          close: () => {
            acquired = false;
            outbox = undefined;
            if (!running) complete();
          },
        });
      },
    },
    start() {
      if (running) return running;
      if (!acquired || !outbox || controller.signal.aborted)
        return Promise.reject(new Error("Outbox worker is not available for admission."));
      const selected = outbox;
      const workOptions = Object.freeze({
        signal: controller.signal,
        pollMs,
        [workerApplicationShutdown]: applicationShutdown,
      });
      running = Promise.resolve()
        .then(() =>
          controller.signal.aborted || applicationShutdown?.aborted
            ? undefined
            : selected.work(workOptions),
        )
        .catch((error: unknown) => {
          if ((!controller.signal.aborted && !applicationShutdown?.aborted) || !expectedStop(error))
            throw error;
        });
      void running.then(
        () => complete(),
        (error) => complete({ value: error }),
      );
      return running;
    },
    stop,
  });
}

export type { OutboxWorkerTransport };
export { createOutboxWorkerTransport };
