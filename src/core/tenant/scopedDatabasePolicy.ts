import { assertSameSessionSelection } from "#strata-orm-internal";
import type { ExecutionContext } from "../contracts/application";
import type { OwnedExecution } from "../contracts/executionOwnership";
import type { EstablishedDatabasePolicy, ScopedPolicy } from "../contracts/persistence";
import type { DatabaseSession, TransactionSession } from "../database/session";

export type { EstablishedDatabasePolicy, ScopedPolicy } from "../contracts/persistence";
export function assertBypassIdentifier(identifier: string | number): void {
  if (
    typeof identifier === "number"
      ? Number.isSafeInteger(identifier) && identifier > 0
      : typeof identifier === "string" && identifier.trim().length > 0
  )
    return;
  throw new TypeError("RLS bypass requires a caller-supplied identifier that pins the row.");
}

/** The existing execution tree is the restore barrier, not merely the callback body. */
export function createScopedPolicy(
  ownership: OwnedExecution,
  context: Pick<ExecutionContext, "tenant">,
  selectedRoot: DatabaseSession,
): ScopedPolicy {
  return Object.freeze({
    run: <T>(
      selected: DatabaseSession | TransactionSession,
      policy: EstablishedDatabasePolicy,
      work: (child: TransactionSession) => T | Promise<T>,
    ): Promise<T> => {
      assertSameSessionSelection(selectedRoot, selected);
      if (
        !policy ||
        typeof policy !== "object" ||
        !["tenant", "identifier", "bypass"].includes(policy.kind)
      )
        throw new TypeError("Invalid established database policy.");
      if (selected.dialect.driver !== "pgsql") {
        throw new TypeError("RLS tenant scope requires PostgreSQL.");
      }
      if (typeof work !== "function") throw new TypeError("Policy callback must be a function.");
      if (policy.kind === "tenant") {
        if (typeof policy.tenantId !== "number")
          throw new TypeError("Tenant identity must be a positive integer.");
        assertBypassIdentifier(policy.tenantId);
        if (!context.tenant || context.tenant.id !== policy.tenantId)
          throw new Error("Established tenant identity mismatch.");
      }
      if (policy.kind === "identifier") assertBypassIdentifier(policy.identifier);
      const applied: EstablishedDatabasePolicy = Object.freeze(
        policy.kind === "tenant"
          ? { kind: "tenant", tenantId: policy.tenantId }
          : policy.kind === "identifier"
            ? { kind: "identifier", identifier: String(policy.identifier).trim() }
            : { kind: "bypass" },
      );
      return selected.transaction(async (child) => {
        const [previous] = await child.execute<{
          tenant_id: string | null;
          bypass_rls: string | null;
          bypass_identifier: string | null;
        }>({
          text: `SELECT current_setting('app.tenant_id', true) AS tenant_id,
          current_setting('app.bypass_rls', true) AS bypass_rls,
          current_setting('app.bypass_identifier', true) AS bypass_identifier`,
          params: [],
        });
        if (applied.kind === "tenant") {
          await child.execute({
            text: `SELECT set_config('app.tenant_id', $1, true), set_config('app.bypass_rls', $2, true)`,
            params: [String(applied.tenantId), "false"],
          });
        } else if (applied.kind === "bypass") {
          await child.execute({
            text: `SELECT set_config('app.bypass_rls', $1, true)`,
            params: ["true"],
          });
        } else {
          await child.execute({
            text: `SELECT set_config('app.bypass_identifier', $1, true)`,
            params: [String(applied.identifier).trim()],
          });
        }
        const observation = await ownership.joined(() => work(child));
        if (!observation.body.ok) throw observation.body.error;
        // Strict descendant failures already belong to the controller's tree. Returning
        // the body value does not authorize commit; never reinsert its error summary.
        if (observation.strictFailed || observation.retained) return observation.body.value;
        await child.execute({
          text: `SELECT set_config('app.tenant_id', $1, true),
          set_config('app.bypass_rls', $2, true), set_config('app.bypass_identifier', $3, true)`,
          params: [
            previous?.tenant_id ?? "",
            previous?.bypass_rls ?? "",
            previous?.bypass_identifier ?? "",
          ],
        });
        return observation.body.value;
      });
    },
  });
}
