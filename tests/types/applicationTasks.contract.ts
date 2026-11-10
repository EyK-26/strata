/** Compiled in source and installed consumers; never executed. */
import type { ExecutionTaskOutcome as RootOutcome } from "@getstrata/core";
import type { ExecutionTaskOutcome as ContextOutcome } from "@getstrata/core/contracts/executionContext";
import type {
  CommandScope,
  ExecutionTaskOutcome,
  OpenOutcome,
  ResourceSpec,
} from "@getstrata/core/runtime/application";

export async function taskContracts(scope: CommandScope) {
  const spec: ResourceSpec<number> = {
    name: "typed task resource",
    open(signal): OpenOutcome<number> {
      const aborted: boolean = signal.aborted;
      void aborted;
      return { ok: true, value: 7 };
    },
    close(value, context) {
      const count: number = value;
      const cleanupSignal: AbortSignal = context.signal;
      void [count, cleanupSignal];
    },
  };
  const acquired: Promise<number> = scope.acquire(spec);
  const sameAcquire: CommandScope["acquire"] = scope.acquire;
  void [acquired, sameAcquire];
  // @ts-expect-error Scope acquire identity is readonly.
  scope.acquire = sameAcquire;
  // @ts-expect-error Resource specifications are required.
  scope.acquire();
  // @ts-expect-error Explicit acquired payload must match the resource specification.
  scope.acquire<string>(spec);
  // @ts-expect-error Open returns an explicit outcome, not a raw handle.
  scope.acquire({ name: "raw handle", open: () => 1, close() {} });
  // @ts-expect-error Acquisition accepts a synchronous descriptor, not an async factory or Promise.
  scope.acquire(Promise.resolve(spec));
  // @ts-expect-error No incidental per-task timeout or ownership options overload.
  scope.acquire(spec, { timeoutMs: 1 });
  // @ts-expect-error Inline descriptor inference cannot widen away an assimilable Promise handle.
  scope.acquire({
    name: "inline promise",
    open: () => ({ ok: true, value: Promise.resolve(1) }),
    close() {},
  });
  const promiseSpec: ResourceSpec<Promise<number>> = {
    name: "promise",
    open: () => ({ ok: true, value: Promise.resolve(1) }),
    close() {},
  };
  // @ts-expect-error Promise handles cannot be returned through native acquisition Promise assimilation.
  scope.acquire(promiseSpec);
  const unionSpec: ResourceSpec<number | Promise<number>> = {
    name: "union",
    open: () => ({ ok: true, value: 1 }),
    close() {},
  };
  // @ts-expect-error Union payloads cannot hide a Promise resource handle.
  scope.acquire(unionSpec);
  const callable = {
    // biome-ignore lint/suspicious/noThenProperty: Negative type contract intentionally declares an assimilable resource handle.
    then(resolve: (value: number) => void) {
      resolve(1);
    },
  };
  const callableSpec: ResourceSpec<typeof callable> = {
    name: "callable",
    open: () => ({ ok: true, value: callable }),
    close() {},
  };
  // @ts-expect-error Callable-then resource handles are forbidden even without the full PromiseLike shape.
  scope.acquire(callableSpec);
  const optionalSpec: ResourceSpec<{ then?: (resolve: (value: number) => void) => void }> = {
    name: "optional",
    open: () => ({ ok: true, value: {} }),
    close() {},
  };
  // @ts-expect-error Optional callable then is still an assimilable resource payload type.
  scope.acquire(optionalSpec);
  const result: Promise<ExecutionTaskOutcome<number>> = scope.spawn((child) => {
    const same: CommandScope = child;
    void same;
    const childAcquired: Promise<number> = child.acquire(spec);
    void childAcquired;
    return 7;
  });
  const outcome = await result;
  const root: RootOutcome<number> = outcome;
  const context: ContextOutcome<number> = root;
  void context;
  if (outcome.ok) {
    const value: number = outcome.value;
    void value;
    // @ts-expect-error Successful outcomes have no error.
    outcome.error;
    // @ts-expect-error Owner records are readonly.
    outcome.value = 9;
  } else {
    const error: unknown = outcome.error;
    void error;
    // @ts-expect-error Failed outcomes have no value.
    outcome.value;
    // @ts-expect-error Opaque errors cannot be assumed to be Errors.
    const assumed: Error = outcome.error;
    void assumed;
  }
  const asyncResult: Promise<ExecutionTaskOutcome<string>> = scope.spawn(async () => "value");
  void asyncResult;
  // @ts-expect-error Child callbacks are required.
  scope.spawn();
  // @ts-expect-error Callbacks must be callable.
  scope.spawn(1);
  // @ts-expect-error No detached/options overload.
  scope.spawn(() => 1, { detached: true });
  // @ts-expect-error Task callbacks receive the explicit command scope.
  scope.spawn((value: number) => value);
  // @ts-expect-error Child observation is an outcome, not its body value.
  const raw: Promise<number> = scope.spawn(() => 1);
  void raw;
  const sameSpawn: CommandScope["spawn"] = scope.spawn;
  // @ts-expect-error Scope spawn identity is readonly.
  scope.spawn = sameSpawn;
}
