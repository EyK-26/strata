import type { CommandScope, ExecutionTaskOutcome } from "../contracts/application";

type Work<T> = (scope: CommandScope) => T | Promise<T>;
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
  work: Work<T>,
  spawn: CommandScope["spawn"],
  resources: TaskResources,
) => Operation<T>;
type BodyOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: unknown };
type Settlement<T> = {
  readonly body: BodyOutcome<T>;
  /** Private occurrences, never a publicly observed aggregate's mutable structure. */
  readonly failures: readonly unknown[];
};

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

/** Joins actual bodies recursively; public subtree summaries never enter the ledger. */
function settleExecutionTasks<T>(
  work: Work<T>,
  check: () => void,
  createOperation: OperationFactory,
  resources: TaskResources,
): Promise<Settlement<T>> {
  const node = <T>(
    body: Work<T>,
    resources: TaskResources,
  ): {
    settlement: Promise<Settlement<T>>;
    invoke(): void;
  } => {
    const children: Promise<Settlement<unknown>>[] = [];
    const spawn: CommandScope["spawn"] = <T>(childWork: Work<T>) => {
      try {
        if (typeof childWork !== "function") {
          throw new TypeError("Execution task callback must be a function.");
        }
        check();
      } catch (error) {
        const rejected = Promise.reject<ExecutionTaskOutcome<T>>(error);
        void rejected.catch(() => {});
        return rejected;
      }
      const child = node(childWork, resources.child());
      children.push(child.settlement);
      // Register ownership before scheduling; user callbacks never run inside spawn.
      void Promise.resolve().then(child.invoke);
      return child.settlement.then(outcome);
    };
    const operation = createOperation<T>(
      (scope) => {
        // Inside the leased body: a skipped invocation still closes its own lease.
        check();
        return body(scope);
      },
      spawn,
      resources,
    );
    const own: Promise<BodyOutcome<T>> = operation.promise.then(
      (value) => ({ ok: true, value }),
      (error: unknown) => ({ ok: false, error }),
    );
    const settlement = own.then(async (result): Promise<Settlement<T>> => {
      // Actual body settlement closes admission on this node, finalizing its list.
      const descendants = await Promise.all(children);
      const owned = await resources.finalize();
      const failures: unknown[] = result.ok ? [] : [result.error];
      for (const failure of owned.acquisitionFailures) failures.push(failure);
      for (const child of descendants) {
        for (const failure of child.failures) failures.push(failure);
      }
      for (const failure of owned.cleanupFailures) failures.push(failure);
      return { body: result, failures };
    });
    return { settlement, invoke: operation.invoke };
  };
  const root = node(work, resources);
  root.invoke();
  return root.settlement;
}

/** Build the public root observation only after all execution-owned cleanup is included. */
function completeExecution<T>(result: Settlement<T>): T {
  const observed = outcome(result);
  if (observed.ok) return observed.value;
  throw observed.error;
}

export type { Settlement, TaskResources };
export { completeExecution, settleExecutionTasks };
