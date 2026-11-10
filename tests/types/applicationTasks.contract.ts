/** Compiled in source and installed consumers; never executed. */
import type { ExecutionTaskOutcome as RootOutcome } from "@getstrata/core";
import type { ExecutionTaskOutcome as ContextOutcome } from "@getstrata/core/contracts/executionContext";
import type { CommandScope, ExecutionTaskOutcome } from "@getstrata/core/runtime/application";

export async function taskContracts(scope: CommandScope) {
  const result: Promise<ExecutionTaskOutcome<number>> = scope.spawn((child) => {
    const same: CommandScope = child;
    void same;
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
