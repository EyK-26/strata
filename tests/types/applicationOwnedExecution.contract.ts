/** Internal ownership seam types only; no root public capability is added. */
// @ts-expect-error Joined ownership is internal and is intentionally absent from the core root.
import { CORE_EXECUTION_OWNERSHIP_TOKEN as UnsupportedRootOwnership } from "@getstrata/core";
import type { ExecutionOperations } from "@getstrata/core/contracts/executionOperations";
import {
  CORE_EXECUTION_OWNERSHIP_TOKEN,
  type Joined,
  type OwnedBoundary,
  type OwnedExecution,
  type OwnedInvocation,
} from "@getstrata/core/contracts/executionOwnership";
import type { ServiceToken } from "@getstrata/core/contracts/token";
import type { CommandScope } from "@getstrata/core/runtime/application";

export function ownedExecutionContracts(
  scope: CommandScope,
  boundary: OwnedBoundary,
  result: Joined<number>,
  operations: ExecutionOperations,
) {
  const ownership: OwnedExecution = scope.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN);
  const token: ServiceToken<OwnedExecution> = CORE_EXECUTION_OWNERSHIP_TOKEN;
  const observation: Promise<Joined<number>> = ownership.joined(
    async (task) => {
      const value: number = await task.acquire({
        name: "own resource",
        open: () => ({ ok: true, value: 7 }),
        close() {},
      });
      task.assertWithin();
      const native = task.bindNative(async (number: number, text: string) => number + text.length);
      const nativeValue: Promise<number> = native(value, "text");
      void nativeValue;
      return value;
    },
    (invoke) => invoke(),
  );
  const enter: OwnedInvocation = (invoke) => invoke();
  const bodyOnly: Promise<number> = operations.operation(() => 7);
  void [token, observation, enter, bodyOnly, UnsupportedRootOwnership];
  // @ts-expect-error Internal joined results do not widen public body-only operations.
  const publicJoined: Promise<Joined<number>> = operations.operation(() => 7);
  void publicJoined;
  // @ts-expect-error Work is required.
  ownership.joined();
  // @ts-expect-error Joined work must be callable.
  ownership.joined(1);
  // @ts-expect-error Explicit body payload type must match the actual work result.
  ownership.joined<string>(() => 7);
  ownership.joined(
    () => 7,
    // @ts-expect-error Enter must invoke synchronously and return R rather than Promise<R>.
    async (invoke) => invoke(),
  );
  // @ts-expect-error There is no public detached/timeout option on the internal port.
  ownership.joined(() => 7, { detached: true });
  // @ts-expect-error Joined is readonly owned observation data.
  result.invoked = false;
  // @ts-expect-error Strict provenance cannot be cleared by a caller.
  result.strict = [];
  // @ts-expect-error Strict occurrences cannot be appended by a controller.
  result.strict.push({ error: "duplicate" });
  if (result.strict[0]) {
    // @ts-expect-error Occurrence records are immutable too.
    result.strict[0].error = "changed";
  }
  if (result.body.ok) {
    const value: number = result.body.value;
    void value;
    // @ts-expect-error Body observation is readonly.
    result.body.value = 8;
  } else {
    const opaque: unknown = result.body.error;
    void opaque;
  }
  const sameAcquire = boundary.acquire;
  // @ts-expect-error Owned boundary methods retain their readonly identities.
  boundary.acquire = sameAcquire;
  // @ts-expect-error Boundary has no universal resolver.
  boundary.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN);
  // @ts-expect-error Boundary exposes no captured outer-scope spawn capability.
  boundary.spawn(() => 7);
  // @ts-expect-error Execution capability dispatches children and does not acquire on the caller's root.
  ownership.acquire({ name: "wrong owner", open: () => ({ ok: true, value: 1 }), close() {} });
  // @ts-expect-error Native continuation contract requires actual Promise completion.
  boundary.bindNative((value: number) => value);
  const bound = boundary.bindNative(async (value: number) => value);
  // @ts-expect-error Bound native callback preserves its original argument type.
  bound("wrong");
  const promise = Promise.resolve(1);
  // @ts-expect-error Resource handles cannot be Promise payloads; the spec itself matches Promise<number>.
  boundary.acquire({
    name: "promise handle",
    open: () => ({ ok: true, value: promise }),
    close() {},
  });
  // biome-ignore lint/suspicious/noThenProperty: Intentional negative payload must match its ResourceSpec independently of the nonthenable restriction.
  const callable = { then: (_resolve: (value: number) => unknown) => {} };
  // @ts-expect-error Resource handles cannot have callable then payloads; only the payload restriction rejects this spec.
  boundary.acquire({
    name: "then handle",
    open: () => ({ ok: true, value: callable }),
    close() {},
  });
  // @ts-expect-error Canonical token remains invariant in payload type.
  const widened: ServiceToken<OwnedExecution | number> = CORE_EXECUTION_OWNERSHIP_TOKEN;
  void widened;
}
