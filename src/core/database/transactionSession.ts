import { AsyncLocalStorage } from "node:async_hooks";
import { mapDatabaseError, PersistenceError } from "@getstrata/core/database/errors";
import type { ExecutionContext } from "../contracts/application";
import type { ExecutionOperations } from "../contracts/executionOperations";
import type { Joined, OwnedBoundary, OwnedExecution } from "../contracts/executionOwnership";
import type {
  ControlEvidence,
  DatabaseCapabilities,
  DataDisposition,
  Decision,
  DecisionStage,
  FailureTag,
  NativeState,
  RawPin,
  RawPool,
  RawTransaction,
  SavepointTerminal,
  SqlStatement,
  Terminal,
  TransactionOptions,
} from "./driverPorts";
import type { SqlDialect } from "./sqlDialects";

interface TransactionSession {
  readonly dialect: SqlDialect;
  readonly capabilities: DatabaseCapabilities;
  execute<Row>(statement: SqlStatement): Promise<readonly Row[]>;
  transaction<T>(work: (tx: TransactionSession) => T | Promise<T>): Promise<T>;
  afterCommit(work: () => void | Promise<void>): void;
  requestRollback(): void;
}

type Observer = () => void | Promise<void>;
type Business<T> =
  | Readonly<{ kind: "not-admitted"; error: unknown }>
  | Readonly<{
      kind: "joined";
      observation: Joined<T>;
      requestedRollback: boolean;
      sqlFailure: FailureTag | null;
      poisoned: boolean;
      childFailure: FailureTag | null;
      observers: readonly Observer[];
    }>;
type Branch = {
  readonly pool: RawPool;
  readonly raw: RawTransaction;
  boundary?: OwnedBoundary;
  phase: "open" | "joining" | "terminal";
  child: boolean;
  rollback: boolean;
  sqlFailure: FailureTag | null;
  poison: FailureTag | null;
  childFailure: FailureTag | null;
  readonly observers: Observer[];
};
type Attempt<T> = {
  stage: DecisionStage<Business<T>>;
  business?: Business<T>;
  terminal?: Terminal<Business<T>> | SavepointTerminal<Business<T>>;
  nativeFailure: FailureTag | null;
  nativeState: NativeState;
  releaseAcknowledged: boolean;
  checkoutFailed: boolean;
  preAdmissionFailure?: FailureTag;
  branch?: Branch;
};

function rejected<T>(error: unknown): Promise<T> {
  const promise = Promise.reject<T>(error);
  void promise.catch(() => {});
  return promise;
}
function failure(error: unknown): FailureTag {
  return Object.freeze({ error });
}
function scopeError(): PersistenceError {
  return new PersistenceError("DATABASE_TRANSACTION_SCOPE");
}

function signalAccessor(): (this: AbortSignal) => unknown {
  const getter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
  if (!getter) throw new TypeError("Platform AbortSignal accessors are required.");
  return getter;
}
const signalAborted = signalAccessor();
const throwIfAborted = AbortSignal.prototype.throwIfAborted;
function checkSignal(signal: AbortSignal | undefined): void {
  if (signal !== undefined) throwIfAborted.call(signal);
}
function snapshotTransactionOptions(input: TransactionOptions): TransactionOptions {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new PersistenceError("DATABASE_CONFIG_INVALID");
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null)
    throw new PersistenceError("DATABASE_CONFIG_INVALID");
  const result: {
    acquisitionSignal?: AbortSignal;
    acquisitionMetrics?: TransactionOptions["acquisitionMetrics"];
  } = {};
  for (const key of Reflect.ownKeys(input)) {
    if (key !== "acquisitionSignal" && key !== "acquisitionMetrics")
      throw new PersistenceError("DATABASE_CONFIG_INVALID");
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
      throw new PersistenceError("DATABASE_CONFIG_INVALID");
    if (descriptor.value !== undefined) result[key] = descriptor.value;
  }
  if (result.acquisitionSignal !== undefined) signalAborted.call(result.acquisitionSignal);
  return Object.freeze(result);
}

/** Captures the parameter ARRAY; native bind-value codec/reference semantics remain unchanged. */
function snapshotStatement(input: SqlStatement): SqlStatement {
  if (!input || typeof input !== "object") throw new PersistenceError("DATABASE_CONFIG_INVALID");
  const text = Object.getOwnPropertyDescriptor(input, "text");
  const params = Object.getOwnPropertyDescriptor(input, "params");
  if (
    !text ||
    !("value" in text) ||
    typeof text.value !== "string" ||
    !text.value.trim() ||
    !params ||
    !("value" in params) ||
    !Array.isArray(params.value)
  )
    throw new PersistenceError("DATABASE_CONFIG_INVALID");
  const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(
    params.value,
  );
  const length: unknown = descriptors.length?.value;
  if (
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > 0xffffffff
  )
    throw new PersistenceError("DATABASE_CONFIG_INVALID");
  const copied: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const item = descriptors[String(index)];
    if (!item || !("value" in item)) throw new PersistenceError("DATABASE_CONFIG_INVALID");
    copied.push(item.value);
  }
  return Object.freeze({ text: text.value, params: Object.freeze(copied) });
}
function summary(errors: readonly unknown[]): unknown {
  if (errors.length === 1) return errors[0];
  const result = new AggregateError([...errors], "Database transaction failures.", {
    cause: errors[0],
  });
  Object.freeze(result.errors);
  return Object.freeze(result);
}
function actualResult<T>(business: Business<T> | undefined) {
  return business?.kind === "joined" && business.observation.invoked
    ? business.observation.body
    : undefined;
}
function healthy<T>(business: Business<T>): boolean {
  return (
    business.kind === "joined" &&
    business.observation.body.ok &&
    !business.observation.strictFailed &&
    !business.observation.retained &&
    !business.requestedRollback &&
    business.sqlFailure === null &&
    !business.poisoned
  );
}

/** One execution-local persistence context; task and resource ownership stay in the kernel. */
class TransactionRuntime {
  private readonly storage = new AsyncLocalStorage<Branch | undefined>();

  constructor(
    private readonly context: ExecutionContext,
    private readonly operations: ExecutionOperations,
    private readonly ownership: OwnedExecution,
  ) {}

  assertOutside(): void {
    this.operations.assertActive();
    if (this.storage.getStore()) throw scopeError();
  }

  private assertBranch(branch: Branch): void {
    this.operations.assertActive();
    if (
      this.storage.getStore() !== branch ||
      branch.phase === "terminal" ||
      branch.child ||
      branch.poison
    )
      throw scopeError();
    if (!branch.boundary) throw scopeError();
    branch.boundary.assertWithin();
  }

  private facade(branch: Branch): TransactionSession {
    const session: TransactionSession = {
      dialect: branch.pool.dialect,
      capabilities: branch.pool.capabilities,
      execute: <Row>(input: SqlStatement) => {
        try {
          this.assertBranch(branch);
          const statement = snapshotStatement(input);
          return this.operations.operation(() => {
            this.assertBranch(branch);
            const failed = (error: unknown): never => {
              const mapped = mapDatabaseError(error);
              branch.sqlFailure ??= failure(mapped);
              throw mapped;
            };
            try {
              return Promise.resolve(branch.raw.execute<Row>(statement)).catch(failed);
            } catch (error) {
              return failed(error);
            }
          });
        } catch (error) {
          return rejected(error);
        }
      },
      transaction: <T>(work: (tx: TransactionSession) => T | Promise<T>) => {
        try {
          this.assertBranch(branch);
          if (typeof work !== "function")
            throw new TypeError("Transaction callback must be a function.");
          if (!branch.pool.capabilities.savepoints)
            throw new PersistenceError("DATABASE_UNSUPPORTED_CAPABILITY");
          branch.child = true;
          const promise = this.operations.operation(() => this.nested(branch, work));
          // Also release the admission latch if a reserved callback is skipped.
          void promise.then(
            () => {
              branch.child = false;
            },
            () => {
              branch.child = false;
            },
          );
          return promise;
        } catch (error) {
          return rejected(error);
        }
      },
      afterCommit: (work) => {
        this.assertBranch(branch);
        if (typeof work !== "function")
          throw new TypeError("After-commit callback must be a function.");
        branch.observers.push(work);
      },
      requestRollback: () => {
        this.assertBranch(branch);
        branch.rollback = true;
      },
    };
    return Object.freeze(session);
  }

  private async business<T>(
    pool: RawPool,
    raw: RawTransaction,
    work: (tx: TransactionSession) => T | Promise<T>,
    attempt: Attempt<T>,
  ): Promise<Business<T>> {
    const branch: Branch = {
      pool,
      raw,
      phase: "open",
      child: false,
      rollback: false,
      sqlFailure: null,
      poison: null,
      childFailure: null,
      observers: [],
    };
    attempt.branch = branch;
    try {
      const observation = await this.ownership.joined(
        (task) => {
          branch.boundary = task;
          try {
            return work(this.facade(branch));
          } finally {
            branch.phase = "joining";
          }
        },
        (invoke) => this.storage.run(branch, invoke),
      );
      return Object.freeze({
        kind: "joined",
        observation,
        requestedRollback: branch.rollback,
        sqlFailure: branch.sqlFailure,
        poisoned: branch.poison !== null,
        childFailure: branch.childFailure,
        observers: Object.freeze([...branch.observers]),
      });
    } catch (error) {
      return Object.freeze({ kind: "not-admitted", error });
    } finally {
      branch.phase = "terminal";
    }
  }

  private newAttempt<T>(): Attempt<T> {
    return {
      stage: Object.freeze({ kind: "callback-not-entered" }),
      nativeFailure: null,
      nativeState: "idle",
      releaseAcknowledged: false,
      checkoutFailed: false,
    };
  }

  private async control<T>(
    task: OwnedBoundary,
    attempt: Attempt<T>,
    pool: RawPool,
    native: (
      callback: (raw: RawTransaction) => Promise<Decision<Business<T>>>,
    ) => Promise<Terminal<Business<T>> | SavepointTerminal<Business<T>>>,
    work: (tx: TransactionSession) => T | Promise<T>,
    admission?: AbortSignal,
  ): Promise<void> {
    let continuation: Promise<Decision<Business<T>>> | undefined;
    const callback = task.bindNative((raw: RawTransaction) => {
      if (attempt.stage.kind !== "callback-not-entered")
        return rejected<Decision<Business<T>>>(new PersistenceError("DATABASE_TRANSACTION_FAILED"));
      attempt.stage = Object.freeze({ kind: "callback-running" });
      continuation = (async () => {
        try {
          checkSignal(admission);
          const business = await this.business(pool, raw, work, attempt);
          attempt.business = business;
          const decision: Decision<Business<T>> = Object.freeze({
            finish: healthy(business) ? "commit" : "rollback",
            result: business,
          });
          attempt.stage = Object.freeze({ kind: "decided", decision });
          return decision;
        } catch (error) {
          attempt.stage = Object.freeze({ kind: "callback-failed", error });
          throw error;
        }
      })();
      void continuation.catch(() => {});
      return continuation;
    });
    try {
      attempt.terminal = await native(callback);
      attempt.nativeState = attempt.terminal.nativeState;
      // Native control can fail while an already-entered controller/J still runs.
      if (attempt.terminal.failure || attempt.terminal.data === "unknown") {
        if (attempt.branch)
          attempt.branch.poison =
            attempt.terminal.failure ??
            failure(new PersistenceError("DATABASE_TRANSACTION_UNKNOWN"));
      }
    } catch (error) {
      attempt.nativeFailure = failure(error);
      attempt.nativeState = "unknown";
      if (attempt.branch) attempt.branch.poison = attempt.nativeFailure;
    } finally {
      // This is the ACTUAL native callback continuation, never a waiter race.
      // C additionally joins J automatically through the one kernel tree.
      if (continuation) await continuation.catch(() => {});
    }
  }

  private evidence<T>(attempt: Attempt<T>, joined: Joined<unknown>): unknown[] {
    const errors: unknown[] = [];
    const business = attempt.business;
    if (attempt.preAdmissionFailure) errors.push(attempt.preAdmissionFailure.error);
    if (business?.kind === "not-admitted") errors.push(business.error);
    else if (
      business?.kind === "joined" &&
      business.observation.invoked &&
      !business.observation.body.ok
    )
      errors.push(business.observation.body.error);
    if (business?.kind === "joined" && business.childFailure)
      errors.push(business.childFailure.error);
    if (attempt.stage.kind === "callback-failed") errors.push(attempt.stage.error);
    const phases: readonly ControlEvidence[] = attempt.terminal?.phases ?? [];
    const failedPhases = phases.filter((phase) => phase.failure !== null);
    for (const phase of failedPhases) if (phase.failure) errors.push(phase.failure.error);
    // Terminal.failure summarizes its phase/stage evidence, not another occurrence.
    if (
      attempt.terminal?.failure &&
      failedPhases.length === 0 &&
      attempt.stage.kind !== "callback-failed"
    )
      errors.push(attempt.terminal.failure.error);
    if (attempt.nativeFailure) errors.push(attempt.nativeFailure.error);
    for (const occurrence of joined.strict) errors.push(occurrence.error);
    return errors;
  }

  private result<T>(attempt: Attempt<T>, joined: Joined<unknown>, nested: boolean): T {
    const terminal = attempt.terminal;
    const business = attempt.business;
    const result = actualResult(business);
    const data: DataDisposition =
      terminal?.data === "released"
        ? "unknown"
        : (terminal?.data ??
          (attempt.checkoutFailed ||
          (attempt.stage.kind === "callback-not-entered" && !attempt.nativeFailure)
            ? "not-started"
            : "unknown"));
    const errors = this.evidence(attempt, joined);
    if (!joined.body.ok && joined.invoked) errors.push(joined.body.error);
    const intendedRollback = business?.kind === "joined" && business.requestedRollback;
    const sqlFailure = business?.kind === "joined" ? business.sqlFailure : null;
    const acknowledged = nested ? terminal?.data === "released" : terminal?.data === "committed";
    const rolledBack = terminal?.data === "rolled-back";
    if (
      !errors.length &&
      !joined.strictFailed &&
      !joined.retained &&
      result?.ok &&
      ((acknowledged && business !== undefined && healthy(business)) ||
        (rolledBack && intendedRollback && !sqlFailure))
    )
      return result.value;
    if (
      rolledBack &&
      result &&
      !result.ok &&
      errors.length === 1 &&
      !joined.strictFailed &&
      !joined.retained
    )
      throw result.error;
    if (
      rolledBack &&
      attempt.stage.kind === "callback-failed" &&
      errors.length === 1 &&
      !joined.strictFailed &&
      !joined.retained
    )
      throw attempt.stage.error;
    const options = {
      data,
      ...(result ? { result } : {}),
      ...(errors.length ? { cause: summary(errors) } : {}),
    };
    if (data === "unknown") throw new PersistenceError("DATABASE_TRANSACTION_UNKNOWN", options);
    if (rolledBack && result?.ok && sqlFailure && errors.length === 0)
      throw new PersistenceError("DATABASE_TRANSACTION_ROLLBACK_ONLY", {
        ...options,
        cause: sqlFailure.error,
      });
    throw new PersistenceError("DATABASE_TRANSACTION_FAILED", options);
  }

  private async nested<T>(
    parent: Branch,
    work: (tx: TransactionSession) => T | Promise<T>,
  ): Promise<T> {
    const attempt = this.newAttempt<T>();
    const joined = await this.ownership.joined(async (task) => {
      await this.control(
        task,
        attempt,
        parent.pool,
        (callback) => parent.raw.savepoint(callback),
        work,
      );
    });
    const unsafe =
      !attempt.terminal ||
      (attempt.terminal.data !== "released" && attempt.terminal.data !== "rolled-back") ||
      attempt.nativeFailure !== null;
    if (unsafe) parent.poison = failure(new PersistenceError("DATABASE_TRANSACTION_UNKNOWN"));
    if (
      attempt.terminal?.data === "released" &&
      attempt.business?.kind === "joined" &&
      healthy(attempt.business) &&
      !joined.strictFailed &&
      !joined.retained
    )
      for (const observer of attempt.business.observers) parent.observers.push(observer);
    try {
      return this.result(attempt, joined, true);
    } catch (error) {
      if (unsafe && !joined.strictFailed) parent.childFailure ??= failure(error);
      throw error;
    }
  }

  run<T>(
    pool: RawPool,
    work: (tx: TransactionSession) => T | Promise<T>,
    options: TransactionOptions = {},
  ): Promise<T> {
    try {
      this.assertOutside();
      if (typeof work !== "function")
        throw new TypeError("Transaction callback must be a function.");
      const settings = snapshotTransactionOptions(options);
      if (
        (settings.acquisitionSignal !== undefined && !pool.capabilities.cancellableCheckout) ||
        (settings.acquisitionMetrics !== undefined && !pool.capabilities.observableCheckout)
      )
        throw new PersistenceError("DATABASE_UNSUPPORTED_CAPABILITY");
      checkSignal(settings.acquisitionSignal);
      const admission = settings.acquisitionSignal;
      const checkout = Object.freeze({
        ...(pool.capabilities.cancellableCheckout
          ? { signal: admission ?? this.context.signal }
          : {}),
        ...(settings.acquisitionMetrics !== undefined
          ? { metrics: settings.acquisitionMetrics }
          : {}),
      });
      return this.operations.operation(async () => {
        const attempt = this.newAttempt<T>();
        const joined = await this.ownership.joined(async (task) => {
          let pin: RawPin;
          let opened = false;
          try {
            pin = await task.acquire({
              name: "database.transaction.pin",
              open: () => {
                opened = true;
                return pool.checkout(checkout);
              },
              close: async (owned) => {
                const ack = await (attempt.nativeState === "idle"
                  ? owned.release()
                  : owned.discard());
                if (!ack.ok) throw ack.error;
                attempt.releaseAcknowledged = true;
              },
            });
          } catch (error) {
            // The admitted acquisition's exact error is already C's private strict occurrence.
            attempt.checkoutFailed = true;
            if (!opened) attempt.preAdmissionFailure = failure(error);
            return;
          }
          await this.control(
            task,
            attempt,
            pool,
            (callback) => pin.begin(callback),
            work,
            admission,
          );
        });
        const value = this.result(attempt, joined, false);
        if (
          attempt.terminal?.data === "committed" &&
          attempt.releaseAcknowledged &&
          attempt.business?.kind === "joined"
        ) {
          for (const observer of attempt.business.observers) {
            let observed: Joined<void>;
            try {
              observed = await this.ownership.joined(
                () => observer(),
                (invoke) => this.storage.run(undefined, invoke),
              );
            } catch (error) {
              throw new PersistenceError("DATABASE_POST_COMMIT_FAILED", {
                data: "committed",
                cause: error,
                result: actualResult(attempt.business),
              });
            }
            if (!observed.body.ok || observed.strictFailed || observed.retained) {
              const errors: unknown[] = [];
              if (observed.invoked && !observed.body.ok) errors.push(observed.body.error);
              for (const item of observed.strict) errors.push(item.error);
              throw new PersistenceError("DATABASE_POST_COMMIT_FAILED", {
                data: "committed",
                result: actualResult(attempt.business),
                ...(errors.length ? { cause: summary(errors) } : {}),
              });
            }
          }
        }
        return value;
      });
    } catch (error) {
      return rejected(error);
    }
  }
}

export type { TransactionSession };
export { snapshotStatement, TransactionRuntime };
