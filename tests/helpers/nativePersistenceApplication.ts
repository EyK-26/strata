import type { ResourceSpec } from "@getstrata/core/contracts/application";
import { CORE_EXECUTION_OWNERSHIP_TOKEN } from "@getstrata/core/contracts/executionOwnership";
import { resourceService, type ServiceDeclaration } from "@getstrata/core/contracts/services";
import type { ServiceToken } from "@getstrata/core/contracts/token";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import type {
  DatabaseDefinition,
  RawPin,
  RawPool,
  RawTransaction,
  SqlStatement,
} from "@getstrata/core/database/driverPorts";
import type { DatabaseSession, TransactionSession } from "@getstrata/core/database/session";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { createApplication } from "@getstrata/core/runtime/application";
import { createScopedPolicy } from "@getstrata/core/tenant/scopedDatabasePolicy";

/** Native integration owner; each callback gets its actual invocation's selected facade. */
async function createNativePersistenceApplication(
  definition: DatabaseDefinition,
  observe?: (statement: SqlStatement) => void,
  extraServices: readonly ServiceDeclaration[] = [],
) {
  const services = [...createDatabaseBindings(definition), ...extraServices];
  const overrides = observe
    ? services
        .filter((item) => item.kind === "resource")
        .map((item) => {
          if (item.kind !== "resource") throw Error("Expected pool resource.");
          return resourceService(item.token as ServiceToken<RawPool>, {
            lifetime: "application",
            dependencies: item.dependencies,
            create: (...dependencies) => {
              const descriptor = item.create(...(dependencies as never[])) as ResourceSpec<RawPool>;
              function transaction(raw: RawTransaction): RawTransaction {
                return {
                  execute: <R>(statement: SqlStatement) => {
                    observe?.(statement);
                    return raw.execute<R>(statement);
                  },
                  savepoint: (work) => raw.savepoint((child) => work(transaction(child))),
                };
              }
              function pin(raw: RawPin): RawPin {
                return {
                  begin: (work) => raw.begin((child) => work(transaction(child))),
                  release: () => raw.release(),
                  discard: () => raw.discard(),
                };
              }
              return {
                ...descriptor,
                open: async (signal) => {
                  const outcome = await descriptor.open(signal);
                  if (!outcome.ok) return outcome;
                  const raw = outcome.value;
                  return {
                    ok: true,
                    value: {
                      dialect: raw.dialect,
                      capabilities: raw.capabilities,
                      execute: <R>(statement: SqlStatement) => {
                        observe?.(statement);
                        return raw.execute<R>(statement);
                      },
                      checkout: async (options) => {
                        const acquired = await raw.checkout(options);
                        return acquired.ok ? { ok: true, value: pin(acquired.value) } : acquired;
                      },
                      close: () => raw.close(),
                    },
                  };
                },
              } satisfies ResourceSpec<RawPool>;
            },
          });
        })
    : [];
  const application = createApplication({ providers: [], services, overrides });
  await application.start();
  const run = <T>(work: (database: DatabaseSession) => T | Promise<T>) =>
    application.run((scope) => work(scope.resolve(DATABASE_SESSION_TOKEN)));
  const tenant = <T>(tenantId: number, work: (transaction: TransactionSession) => T | Promise<T>) =>
    application.run(
      {
        kind: "command",
        actor: { kind: "system", policy: "integration.tenant" },
        tenant: { id: tenantId },
      },
      (scope) => {
        const database = scope.resolve(DATABASE_SESSION_TOKEN);
        const policy = createScopedPolicy(
          scope.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN),
          scope.context,
          database,
        );
        return policy.run(database, { kind: "tenant", tenantId }, work);
      },
    );
  const close = async () => {
    const result = await application.stop();
    if (!result.successful)
      throw new Error("Native persistence application shutdown was not confirmed clean.");
  };
  return { application, run, tenant, close };
}
function sessionSql(database: DatabaseSession | TransactionSession) {
  return {
    unsafe: <T>(text: string, params: readonly unknown[] = []) =>
      database.execute<T>({ text, params }).then((rows) => [...rows]),
  };
}

export { createNativePersistenceApplication, sessionSql };
