/** Compiled in source and installed consumers; never executed. */
import {
  CORE_EXECUTION_CONTEXT_TOKEN,
  type ExecutionContext,
} from "@getstrata/core/contracts/executionContext";
import { service } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import type {
  Application,
  CommandScope,
  ExecutionEnvelope,
} from "@getstrata/core/runtime/application";

export function executionContracts(app: Application, scope: CommandScope) {
  const Count = createServiceToken<number>("execution value");
  service(Count, {
    lifetime: "execution",
    dependencies: [CORE_EXECUTION_CONTEXT_TOKEN],
    create: (context) => context.executionId.length,
  });
  const context: ExecutionContext = scope.resolve(CORE_EXECUTION_CONTEXT_TOKEN);
  const first: Promise<number> = app.run((current) => current.resolve(Count));
  const second: Promise<string> = app.run(
    {
      kind: "job",
      actor: { kind: "system", policy: "worker" },
      tenant: { id: "one" },
      metadata: { attempt: 1 },
    },
    async (current) => current.context.executionId,
  );
  const envelope: ExecutionEnvelope = {
    kind: "request",
    actor: { kind: "principal", claims: { subject: "caller", roles: ["reader"] } },
  };
  void [first, second, envelope];
  if (context.kind === "job") {
    const actor: "principal" | "system" = context.actor.kind;
    void actor;
  }
  // @ts-expect-error Job admission requires an explicit actor.
  app.run({ kind: "job" }, () => 1);
  // @ts-expect-error Owner context IDs cannot be provided in envelopes.
  app.run({ kind: "command", executionId: "forged" }, () => 1);
  // @ts-expect-error Actor policy is a string.
  app.run({ kind: "command", actor: { kind: "system", policy: 1 } }, () => 1);
  // @ts-expect-error Context metadata is readonly.
  context.metadata.secret = "mutation";
  // @ts-expect-error Scope context identity is readonly.
  scope.context = context;
  // @ts-expect-error Execution contexts resolve with their invariant public type.
  const wrong: number = scope.resolve(CORE_EXECUTION_CONTEXT_TOKEN);
  void wrong;
  service(Count, {
    lifetime: "execution",
    dependencies: [CORE_EXECUTION_CONTEXT_TOKEN],
    // @ts-expect-error Explicit dependencies retain the context argument type.
    create: (value: number) => value,
  });
}
