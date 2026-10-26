import { recordM1Diagnostic } from "./diagnostics";
import { M1ConfigurationError } from "./validation";

export type M1StartupCleanupOutcome = Readonly<{
  state: "cleaned" | "cleanup-failed" | "metadata-conflict";
  /** Only this attempt's reservation; a foreign context can still block startup. */
  startupReservationReleased: boolean;
  /** Internal errors, like ShutdownResult.errors; not a sanitized transport record. */
  errors: readonly unknown[];
}>;

const completions = new WeakMap<object, Promise<M1StartupCleanupOutcome>>();

/** Never inspects arbitrary error properties or treats an unknown error as safe to retry. */
export function getM1StartupCleanupCompletion(
  failure: unknown,
): Promise<M1StartupCleanupOutcome> | undefined {
  return failure !== null && (typeof failure === "object" || typeof failure === "function")
    ? completions.get(failure)
    : undefined;
}

export function resolveStartupCleanupTimeoutMs(value: unknown): number {
  if (value === undefined) return 30_000;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > 2_147_483_647
  )
    throw new M1ConfigurationError("invalid-cleanup-timeout", "startupCleanupTimeoutMs");
  return value;
}

type OwnedCleanup = {
  primary: unknown;
  timeoutMs: number;
  stop?(): void | Promise<void>;
  dispose(): void | Promise<void>;
  restore?(): boolean;
  release(): void;
};

function outcome(
  state: M1StartupCleanupOutcome["state"],
  startupReservationReleased: boolean,
  errors: readonly unknown[] = [],
): M1StartupCleanupOutcome {
  return Object.freeze({
    state,
    startupReservationReleased,
    errors: Object.freeze([...errors]),
  });
}

/** Bounds waiting, not disposal. One sequence continues observing its own resources after expiry. */
export function rejectAfterStartupCleanup(options: OwnedCleanup): Promise<never> {
  let resolveCompletion!: (value: M1StartupCleanupOutcome) => void;
  const completion = new Promise<M1StartupCleanupOutcome>((resolve) => {
    resolveCompletion = resolve;
  });
  let rejectStartup!: (failure: unknown) => void;
  const waiting = new Promise<never>((_resolve, reject) => {
    rejectStartup = reject;
  });
  let callerRejected = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const failure = (errors: readonly unknown[], timedOut: boolean) => {
    const error = new AggregateError(
      [options.primary, ...errors],
      timedOut ? "M1 startup cleanup timed out." : "M1 startup and cleanup failed.",
      { cause: options.primary },
    );
    completions.set(error, completion);
    recordM1Diagnostic(error, {
      stage: "cleanup",
      code: timedOut ? "startup-cleanup-timed-out" : "startup-cleanup-failed",
      field: "application",
      owner: "application",
    });
    return error;
  };
  const finish = (result: M1StartupCleanupOutcome) => {
    clearTimeout(timer);
    timer = undefined;
    resolveCompletion(result);
    if (!callerRejected) {
      callerRejected = true;
      rejectStartup(result.state === "cleaned" ? options.primary : failure(result.errors, false));
    }
  };
  timer = setTimeout(() => {
    timer = undefined;
    if (!callerRejected) {
      callerRejected = true;
      rejectStartup(failure([new Error("M1 startup cleanup deadline exceeded.")], true));
    }
  }, options.timeoutMs);

  // Consume both late outcomes. Expiry never retries disposal or closes undrained work.
  void Promise.resolve()
    .then(async () => {
      // Failed admission stop leaves infrastructure owned and open.
      await options.stop?.();
      await options.dispose();
      if (options.restore && !options.restore()) {
        const error = new Error("Route metadata ownership changed during startup cleanup.");
        recordM1Diagnostic(error, {
          stage: "cleanup",
          code: "metadata-ownership-changed",
          field: "routes",
          owner: "application",
        });
        return outcome("metadata-conflict", false, [error]);
      }
      options.release();
      return outcome("cleaned", true);
    })
    .then(finish, (error) => finish(outcome("cleanup-failed", false, [error])));
  return waiting;
}
