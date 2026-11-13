/** Compiled contracts; not executed. */
import { Policy, type PolicyDecision, PolicyGate } from "@getstrata/core/auth/policy";

class DocumentPolicy extends Policy {
  readonly label = "documents";
  async edit(actor: { id: string }, document: { owner: string }): Promise<boolean> {
    return actor.id === document.owner;
  }
}

export function policyContracts() {
  const gate = new PolicyGate({ documents: new DocumentPolicy() });
  gate.register("documents", new DocumentPolicy());
  const decision: Promise<boolean> = gate.allows(
    "documents",
    "edit",
    { id: "actor" },
    { owner: "actor" },
  );
  const authorized: Promise<void> = gate.authorize(
    "documents",
    "edit",
    { id: "actor" },
    { owner: "actor" },
  );
  const sync: PolicyDecision = true;
  const asyncDecision: PolicyDecision = Promise.resolve(false);
  void [decision, authorized, sync, asyncDecision];
  // @ts-expect-error Unknown resource.
  gate.register("other", new DocumentPolicy());
  // @ts-expect-error Unknown action.
  gate.allows("documents", "destroy", { id: "actor" });
  // @ts-expect-error Non-decision property.
  gate.allows("documents", "label", { id: "actor" });
  // @ts-expect-error Wrong actor type.
  gate.allows("documents", "edit", { id: 1 }, { owner: "actor" });
  // @ts-expect-error Missing required resource argument.
  gate.allows("documents", "edit", { id: "actor" });
  // @ts-expect-error Wrong resource type.
  gate.authorize("documents", "edit", { id: "actor" }, { owner: 1 });
  // @ts-expect-error Actor must be passed explicitly, even for base policies.
  new PolicyGate().allows("documents", "view");
}
