import type { Application } from "@getstrata/core/contracts/application";
import { CORE_EXECUTION_OWNERSHIP_TOKEN } from "@getstrata/core/contracts/executionOwnership";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { createScopedPolicy } from "@getstrata/core/tenant/scopedDatabasePolicy";
import type { PersistenceInvocation } from "./persistenceContracts";

/** Composition captures an owner, never a startup execution session. */
export function createPersistenceInvocation(
  application: Application,
  connection: string,
): PersistenceInvocation {
  if (!connection.trim()) throw new TypeError("A configured persistence connection is required.");
  return (envelope, work) =>
    application.run(envelope, (scope) => {
      const database = scope.resolve(DATABASE_SESSION_TOKEN).connection(connection);
      const policy = createScopedPolicy(
        scope.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN),
        scope.context,
        database,
      );
      return work(Object.freeze({ database, policy }));
    });
}
