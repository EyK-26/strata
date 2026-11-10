import type { CommandScope, ExecutionTaskOutcome } from "../contracts/application";
import type { ExecutionOperations } from "../contracts/executionOperations";
import type {
  Joined,
  OwnedBoundary,
  OwnedExecution,
  OwnedInvocation,
} from "../contracts/executionOwnership";

type Work<T> = (scope: CommandScope) => T | Promise<T>;
type NodeWork<T> = Work<T> | (() => T | Promise<T>) | ((task: OwnedBoundary) => T | Promise<T>);
type Mode = "strict" | "operation" | "joined" | "bookkeeping";
type Operation<T> = { readonly promise: Promise<T>; invoke(): void };
type TaskResources = {
  readonly acquire: CommandScope["acquire"];
  child(): TaskResources;
  seal(): void;
  finalize(): Promise<{
    readonly acquisitionFailures: readonly unknown[];
    readonly cleanupFailures: readonly unknown[];
    readonly retained: boolean;
  }>;
};
/** The application supplies its existing body lease and the execution's resolver. */
type OperationFactory = <T>(
  work: (scope: CommandScope, task: OwnedBoundary) => T | Promise<T>,
  spawn: CommandScope["spawn"],
  resources: TaskResources,
  dispatch: TaskDispatch,
) => Operation<T>;
type TaskDispatch = {
  readonly operation: ExecutionOperations["operation"];
  readonly joined: OwnedExecution["joined"];
  readonly finalize: OwnedBoundary["finalize"];
  readonly bookkeeping: boolean;
  readonly path: readonly symbol[];
  readonly enter?: OwnedInvocation;
  entryFailed(error: unknown): void;
};
type BodyOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: unknown };
type Settlement<T> = {
  readonly invoked: boolean;
  readonly retained: boolean;
  readonly body: BodyOutcome<T>;
  /** Private occurrences, never a publicly observed aggregate's mutable structure. */
  readonly failures: readonly unknown[];
};

function joinedOutcome<T>(result: Settlement<T>): Joined<T> {
  return Object.freeze({
    invoked: result.invoked,
    body: Object.freeze({ ...result.body }),
    strictFailed: result.failures.length > 0,
    retained: result.retained,
    strict: Object.freeze(result.failures.map((error) => Object.freeze({ error }))),
  });
}

function summary(failures: readonly unknown[]): unknown {
  if (failures.length === 1) return failures[0];
  const error = new AggregateError([...failures], "Execution task failures.", {
    cause: failures[0],
  });
  Object.freeze(error.errors);
  return Object.freeze(error);
}

function outcome<T>(result: Settlement<T>): ExecutionTaskOutcome<T> {
  if (result.body.ok && result.failures.length === 0) return Object.freeze(result.body);
  return Object.freeze({ ok: false, error: summary(result.failures) });
}

function rejected<T>(error: unknown): Promise<T> {
  const promise = Promise.reject<T>(error);
  void promise.catch(() => {});
  return promise;
}

/** Joins actual bodies recursively; public subtree summaries never enter the ledger. */
function settleExecutionTasks<T>(
  work: Work<T>,
  check: () => void,
  createOperation: OperationFactory,
  resources: TaskResources,
  blank: <T>(work: () => T) => T,
): Promise<Settlement<T>> {
  const node = <T>(
    body: NodeWork<T>,
    resources: TaskResources,
    mode: Mode,
    ancestors: readonly symbol[],
    enter?: OwnedInvocation,
  ): {
    body: Promise<T>;
    settlement: Promise<Settlement<T>>;
    invoke(): void;
  } => {
    const children: Promise<Settlement<unknown>>[] = [];
    const path = Object.freeze([...ancestors, Symbol()]);
    const launch = <T>(childWork: NodeWork<T>, mode: Mode, enter?: OwnedInvocation) => {
      if (typeof childWork !== "function") {
        throw new TypeError("Execution task callback must be a function.");
      }
      if (enter !== undefined && typeof enter !== "function") {
        throw new TypeError("Owned invocation context must be a function.");
      }
      // Bookkeeping completes existing ownership rather than admitting new business work.
      if (mode !== "bookkeeping") check();
      // Engine callbacks must not inherit an active same-app parent body frame.
      return blank(() => {
        const child = node<T>(childWork, resources.child(), mode, path, enter);
        children.push(child.settlement);
        // Register ownership before scheduling; user callbacks never run inline.
        void Promise.resolve().then(child.invoke);
        return child;
      });
    };
    const spawn: CommandScope["spawn"] = <T>(childWork: Work<T>) => {
      try {
        return launch<T>(childWork, "strict").settlement.then(outcome);
      } catch (error) {
        return rejected<ExecutionTaskOutcome<T>>(error);
      }
    };
    const operation: ExecutionOperations["operation"] = <T>(work: () => T | Promise<T>) => {
      try {
        // The actual body promise is already observed by the private tagged own outcome.
        return launch<T>(work, "operation").body;
      } catch (error) {
        return rejected<T>(error);
      }
    };
    const joined: OwnedExecution["joined"] = <T>(
      work: (task: OwnedBoundary) => T | Promise<T>,
      enter?: OwnedInvocation,
    ) => {
      try {
        return launch<T>(work, "joined", enter).settlement.then(joinedOutcome);
      } catch (error) {
        return rejected<Joined<T>>(error);
      }
    };
    const finalize: OwnedBoundary["finalize"] = (work) => {
      try {
        return launch<void>(work, "bookkeeping").settlement.then(joinedOutcome);
      } catch (error) {
        return rejected<Joined<void>>(error);
      }
    };
    let invoked = false;
    let entryFailure: { error: unknown } | undefined;
    const bodyOperation = createOperation<T>(
      (scope, task) => {
        // Inside the leased body: a skipped invocation still closes its own lease.
        if (mode !== "bookkeeping") check();
        invoked = true;
        if (mode === "operation" || mode === "bookkeeping") return (body as () => T | Promise<T>)();
        if (mode === "joined") return (body as (task: OwnedBoundary) => T | Promise<T>)(task);
        return (body as Work<T>)(scope);
      },
      spawn,
      resources,
      {
        operation,
        joined,
        finalize,
        bookkeeping: mode === "bookkeeping",
        path,
        enter,
        entryFailed: (error) => {
          entryFailure ??= { error };
        },
      },
    );
    const own: Promise<BodyOutcome<T>> = bodyOperation.promise.then(
      (value) => ({ ok: true, value }),
      (error: unknown) => ({ ok: false, error }),
    );
    const settlement = own.then(async (result): Promise<Settlement<T>> => {
      // Actual body settlement closes admission on this node, finalizing its list.
      const descendants = await Promise.all(children);
      const owned = await resources.finalize();
      const failures: unknown[] = [];
      // Only ordinary work that actually ran is recoverable; reserved skips stay strict.
      if (!result.ok && (mode === "strict" || mode === "bookkeeping" || !invoked))
        failures.push(result.error);
      if (entryFailure) failures.push(entryFailure.error);
      for (const failure of owned.acquisitionFailures) failures.push(failure);
      for (const child of descendants) {
        for (const failure of child.failures) failures.push(failure);
      }
      for (const failure of owned.cleanupFailures) failures.push(failure);
      return {
        invoked,
        retained: owned.retained || descendants.some((child) => child.retained),
        body: result,
        failures,
      };
    });
    return { body: bodyOperation.promise, settlement, invoke: bodyOperation.invoke };
  };
  return blank(() => {
    const root = node(work, resources, "strict", []);
    root.invoke();
    return root.settlement;
  });
}

/** Build the public root observation only after all execution-owned cleanup is included. */
function completeExecution<T>(result: Settlement<T>): T {
  const observed = outcome(result);
  if (observed.ok) return observed.value;
  throw observed.error;
}

export type { Settlement, TaskResources };
export { completeExecution, settleExecutionTasks };
