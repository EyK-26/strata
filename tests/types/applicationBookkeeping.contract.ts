import * as Core from "@getstrata/core";
import type { ExecutionOperations } from "@getstrata/core/contracts/executionOperations";
import {
  CORE_EXECUTION_OWNERSHIP_TOKEN,
  type Joined,
  type OwnedBoundary,
  type OwnedExecution,
} from "@getstrata/core/contracts/executionOwnership";
import type { DatabaseSession, TransactionSession } from "@getstrata/core/database/session";
import type { CommandScope } from "@getstrata/core/runtime/application";

/** Compile-only: trusted synchronous bookkeeping belongs solely to the direct internal boundary. */
export function applicationBookkeepingContracts(
  scope: CommandScope,
  boundary: OwnedBoundary,
  operations: ExecutionOperations,
  session: DatabaseSession,
  transaction: TransactionSession,
) {
  const ownership: OwnedExecution = scope.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN);
  const result: Promise<Joined<void>> = boundary.finalize(() => undefined);
  const loop: Promise<Joined<void>> = ownership.joined(async (controller) => {
    const final: Joined<void> = await controller.finalize(() => undefined);
    void final;
    return undefined;
  });
  // @ts-expect-error Restore callbacks must return undefined synchronously, not a Promise.
  boundary.finalize(async () => {});
  // @ts-expect-error Bookkeeping does not accept arbitrary result values.
  boundary.finalize(() => 7);
  // @ts-expect-error No scope/capability argument is supplied to bookkeeping.
  boundary.finalize((_scope: CommandScope) => undefined);
  // @ts-expect-error No callback argument of any required shape is supplied.
  boundary.finalize((_value: number) => undefined);
  // @ts-expect-error Work must be callable.
  boundary.finalize(1);
  // @ts-expect-error The callback is required.
  boundary.finalize();
  boundary.finalize(
    () => undefined,
    // @ts-expect-error No enter override or options are accepted.
    (invoke: () => void) => invoke(),
  );
  // @ts-expect-error Bookkeeping has no execution-wide admission port.
  ownership.finalize(() => undefined);
  // @ts-expect-error Public command scopes do not gain finalize.
  scope.finalize(() => undefined);
  // @ts-expect-error Public operations do not gain finalize.
  operations.finalize(() => undefined);
  // @ts-expect-error Public database sessions do not gain finalize.
  session.finalize(() => undefined);
  // @ts-expect-error Public transaction sessions do not gain finalize.
  transaction.finalize(() => undefined);
  // @ts-expect-error Existing internal ownership token remains absent from core root.
  Core.CORE_EXECUTION_OWNERSHIP_TOKEN;
  // @ts-expect-error There is no new public finalize token.
  Core.CORE_EXECUTION_FINALIZE_TOKEN;
  // @ts-expect-error Captured boundary methods remain readonly.
  boundary.finalize = () => result;
  void [result, loop];
}
