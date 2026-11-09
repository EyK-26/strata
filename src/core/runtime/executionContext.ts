import { copyApplicationConfig } from "../config/configSnapshot";
import type {
  ApplicationConfig,
  ExecutionActor,
  ExecutionContext,
  ExecutionEnvelope,
} from "../contracts/application";

// Capture platform operations once: envelope signals may override their public members.
function signalAccessor(name: "aborted" | "reason"): (this: AbortSignal) => unknown {
  const getter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, name)?.get;
  if (!getter) throw new TypeError("Platform AbortSignal accessors are required.");
  return getter;
}
const signalAborted = signalAccessor("aborted");
const signalReason = signalAccessor("reason");
const addListener = EventTarget.prototype.addEventListener;
const removeListener = EventTarget.prototype.removeEventListener;

function aborted(signal: AbortSignal): boolean {
  return signalAborted.call(signal) as boolean;
}
function reason(signal: AbortSignal): unknown {
  return signalReason.call(signal);
}

function record(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Execution data must be a plain record.");
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Execution data must be a plain record.");
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !keys.includes(key)) {
      throw new TypeError("Unknown execution data field.");
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("Execution data must contain enumerable own data fields.");
    }
    result[key] = descriptor.value;
  }
  return result;
}

function metadata(value: unknown): ApplicationConfig {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Execution metadata must be a plain record.");
  }
  return copyApplicationConfig(value) as ApplicationConfig;
}
function nonempty(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("Execution identifiers and policies must be nonempty strings.");
  }
}
function actor(input: unknown): ExecutionActor {
  const value = record(input, ["kind", "claims", "policy"]);
  if (value.kind === "principal" && !("policy" in value)) {
    return Object.freeze({ kind: "principal", claims: metadata(value.claims) });
  }
  if (value.kind === "system" && !("claims" in value)) {
    nonempty(value.policy);
    return Object.freeze({ kind: "system", policy: value.policy });
  }
  throw new TypeError("Invalid execution actor.");
}

/** Validation and copying perform no timer, listener, container or factory effects. */
function normalizeExecutionEnvelope(input: unknown): ExecutionEnvelope {
  const value = record(input, [
    "kind",
    "actor",
    "externalId",
    "metadata",
    "tenant",
    "signal",
    "deadlineAtMs",
  ]);
  if (value.kind !== "command" && value.kind !== "request" && value.kind !== "job") {
    throw new TypeError("Invalid execution kind.");
  }
  const result: Record<string, unknown> = { kind: value.kind };
  if (value.actor !== undefined) result.actor = actor(value.actor);
  else if (value.kind === "job") throw new TypeError("Job executions require an actor.");
  if (value.externalId !== undefined) {
    nonempty(value.externalId);
    result.externalId = value.externalId;
  }
  result.metadata = metadata(value.metadata === undefined ? {} : value.metadata);
  if (value.tenant !== undefined) result.tenant = metadata(value.tenant);
  if (value.signal !== undefined) {
    // Both accessors are intrinsic brand checks; proxies and lookalikes fail here.
    aborted(value.signal as AbortSignal);
    reason(value.signal as AbortSignal);
    result.signal = value.signal;
  }
  if (value.deadlineAtMs !== undefined) {
    if (typeof value.deadlineAtMs !== "number") throw new TypeError("Invalid execution deadline.");
    if (!Number.isSafeInteger(value.deadlineAtMs) || value.deadlineAtMs < 0) {
      throw new RangeError("Execution deadline must be a nonnegative safe integer.");
    }
    result.deadlineAtMs = value.deadlineAtMs;
  }
  return Object.freeze(result) as unknown as ExecutionEnvelope;
}

class ExecutionDeadlineError extends Error {
  readonly code = "EXECUTION_DEADLINE";
  constructor(
    readonly applicationId: string,
    readonly executionId: string,
  ) {
    super("EXECUTION_DEADLINE");
  }
}

function ownExecutionContext(
  envelope: ExecutionEnvelope,
  applicationId: string,
  appSignal: AbortSignal,
) {
  const executionId = crypto.randomUUID();
  const controller = new AbortController();
  const subscriptions: { signal: AbortSignal; listener: () => void }[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const cancel = (signal: AbortSignal): void => {
    if (!disposed && aborted(signal) && !controller.signal.aborted)
      controller.abort(reason(signal));
  };
  const subscribe = (signal: AbortSignal): void => {
    const listener = () => cancel(signal);
    addListener.call(signal, "abort", listener);
    subscriptions.push({ signal, listener });
    cancel(signal);
  };
  const dispose = (): void => {
    disposed = true;
    clearTimeout(timer);
    for (const { signal, listener } of subscriptions) {
      removeListener.call(signal, "abort", listener);
    }
  };
  try {
    // At admission an already cancelled external signal precedes the deadline.
    if (envelope.signal !== undefined) subscribe(envelope.signal);
    subscribe(appSignal);
    const deadline = envelope.deadlineAtMs;
    // Timers can be delayed behind synchronous work and promise microtasks. Check
    // wall time at each admission/publication boundary without scheduling more timers.
    const refreshDeadline = (): number | undefined => {
      if (disposed || controller.signal.aborted || deadline === undefined) return;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        controller.abort(new ExecutionDeadlineError(applicationId, executionId));
        return;
      }
      return remaining;
    };
    const check = (): void => {
      refreshDeadline();
      if (controller.signal.aborted) throw controller.signal.reason;
    };
    if (deadline !== undefined) {
      const tick = (): void => {
        const remaining = refreshDeadline();
        if (remaining !== undefined) timer = setTimeout(tick, Math.min(remaining, 2_147_483_647));
      };
      tick();
    }
    const context = Object.freeze({
      ...envelope,
      applicationId,
      executionId,
      signal: controller.signal,
    }) as ExecutionContext;
    return { context, dispose, check };
  } catch (error) {
    dispose();
    throw error;
  }
}

export { normalizeExecutionEnvelope, ownExecutionContext };
