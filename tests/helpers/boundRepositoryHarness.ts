import { createPersistenceInvocation } from "@getstrata/bootstrap/persistenceInvocation";
import type { ExecutionEnvelope, ResourceSpec } from "@getstrata/core/contracts/application";
import type { ScopedPolicy } from "@getstrata/core/contracts/persistence";
import { resourceService, type ServiceDeclaration } from "@getstrata/core/contracts/services";
import type { ServiceToken } from "@getstrata/core/contracts/token";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import type { AnyRepositoryDefinition } from "@getstrata/core/database/definitions";
import type { DatabaseSession } from "@getstrata/core/database/session";
import { createApplication } from "@getstrata/core/runtime/application";
import type { DatabaseConnection } from "../../src/core/database/connectionContracts";
import type {
  DatabaseDefinition,
  Decision,
  RawPin,
  RawPool,
  RawTransaction,
  Terminal,
} from "../../src/core/database/driverPorts";
import { dialectFor } from "../../src/core/database/sqlDialects";

type Driver = "pgsql" | "sqlite" | "mysql";
type SqlFixture = Pick<DatabaseConnection, "unsafe" | "begin">;

/** Synthetic SQL compiler adapter. These ACKs establish fixture behavior only. */
function syntheticRepositoryPool(connection: SqlFixture, driver: Driver): RawPool {
  function transaction(source: SqlFixture): RawTransaction {
    const raw: RawTransaction = {
      execute: (statement) => source.unsafe(statement.text, statement.params),
      async savepoint(work) {
        const decision = await work(raw);
        return {
          data: decision.finish === "commit" ? "released" : "rolled-back",
          nativeState: "transaction-active",
          stage: { kind: "decided", decision },
          phases: [
            {
              phase: decision.finish === "commit" ? "release-savepoint" : "rollback-to",
              acknowledgement: "confirmed-reply",
              failure: null,
            },
            ...(decision.finish === "rollback"
              ? [
                  {
                    phase: "release-savepoint" as const,
                    acknowledgement: "confirmed-reply" as const,
                    failure: null,
                  },
                ]
              : []),
          ],
          failure: null,
        };
      },
    };
    return raw;
  }
  const pin: RawPin = {
    async begin<R>(work: (tx: RawTransaction) => Promise<Decision<R>>): Promise<Terminal<R>> {
      let decision!: Decision<R>;
      if (connection.begin) {
        const rollback = {};
        try {
          await connection.begin(async (source) => {
            decision = await work(transaction(source));
            if (decision.finish === "rollback") throw rollback;
          });
        } catch (error) {
          if (error !== rollback) throw error;
        }
      } else decision = await work(transaction(connection));
      return {
        data: decision.finish === "commit" ? "committed" : "rolled-back",
        nativeState: "idle",
        stage: { kind: "decided", decision },
        phases: [
          { phase: "begin", acknowledgement: "confirmed-reply", failure: null },
          { phase: decision.finish, acknowledgement: "confirmed-reply", failure: null },
        ],
        failure: null,
      };
    },
    async release() {
      return { ok: true };
    },
    async discard() {
      return { ok: true };
    },
  };
  return {
    dialect: dialectFor(driver),
    capabilities: Object.freeze({
      driver,
      transactions: true,
      savepoints: true,
      rowLocks: driver !== "sqlite",
      postgresRls: driver === "pgsql",
      cancellableCheckout: false,
      observableCheckout: false,
      isolatedDiscard: false,
    }),
    execute: (statement) => connection.unsafe(statement.text, statement.params),
    async checkout() {
      return { ok: true, value: pin };
    },
    close() {},
  };
}

type DatabaseInvocation = <T>(
  work: (database: DatabaseSession, policy: ScopedPolicy) => T | Promise<T>,
  envelope?: ExecutionEnvelope,
) => Promise<T>;

interface BoundDatabaseFixture {
  readonly definition: DatabaseDefinition;
  readonly services?: readonly ServiceDeclaration[];
  readonly connection?: SqlFixture;
  readonly driver?: Driver;
  readonly observe?: (statement: { text: string; params: readonly unknown[] }) => void;
}
/** Own a real application graph and live invocation for the whole assertion body. */
async function withBoundDatabase<T>(
  fixture: BoundDatabaseFixture,
  work: (
    database: DatabaseSession,
    invoke: DatabaseInvocation,
    policy: ScopedPolicy,
  ) => T | Promise<T>,
): Promise<T> {
  const declarations = createDatabaseBindings(fixture.definition);
  const resource = declarations.find((item) => item.kind === "resource");
  if (resource?.kind !== "resource") throw new Error("Fixture requires a pool declaration.");
  const app = createApplication({
    providers: [],
    services: [...declarations, ...(fixture.services ?? [])],
    overrides:
      fixture.connection || fixture.observe
        ? [
            resourceService(resource.token as ServiceToken<RawPool>, {
              lifetime: "application",
              dependencies: resource.dependencies,
              create: (...dependencies) => {
                const connection = fixture.connection;
                const descriptor: ResourceSpec<RawPool> = connection
                  ? {
                      name: "repository-fixture",
                      open: () => ({
                        ok: true,
                        value: syntheticRepositoryPool(connection, fixture.driver ?? "pgsql"),
                      }),
                      close: () => {},
                    }
                  : (resource.create(...(dependencies as never[])) as ResourceSpec<RawPool>);
                return {
                  ...descriptor,
                  open: async (context) => {
                    const outcome = await descriptor.open(context);
                    if (!outcome.ok || !fixture.observe) return outcome;
                    const pool = outcome.value;
                    const observe = fixture.observe;
                    function transaction(raw: RawTransaction): RawTransaction {
                      return {
                        execute: (statement) => {
                          observe(statement);
                          return raw.execute(statement);
                        },
                        savepoint: (work) => raw.savepoint((child) => work(transaction(child))),
                      };
                    }
                    const observed: RawPool = {
                      dialect: pool.dialect,
                      capabilities: pool.capabilities,
                      execute: (statement) => {
                        observe(statement);
                        return pool.execute(statement);
                      },
                      checkout: async (options) => {
                        const checkout = await pool.checkout(options);
                        if (!checkout.ok) return checkout;
                        const pin = checkout.value;
                        return {
                          ok: true,
                          value: {
                            begin: (work) => pin.begin((raw) => work(transaction(raw))),
                            release: pin.release.bind(pin),
                            discard: pin.discard.bind(pin),
                          },
                        };
                      },
                      close: pool.close.bind(pool),
                    };
                    return { ok: true as const, value: observed };
                  },
                };
              },
            }),
          ]
        : [],
  });
  await app.start();
  try {
    const invoke: DatabaseInvocation = (body, envelope = { kind: "command" }) =>
      createPersistenceInvocation(app, fixture.definition.default)(envelope, (ports) =>
        body(ports.database, ports.policy),
      );
    return await invoke((database, policy) => work(database, invoke, policy));
  } finally {
    await app.stop();
  }
}

type Repositories<D extends readonly AnyRepositoryDefinition[]> = {
  [I in keyof D]: D[I] extends { readonly create: (...args: never[]) => infer T } ? T : never;
};
function withRepositories<const D extends readonly AnyRepositoryDefinition[], T>(
  connection: SqlFixture,
  definitions: D,
  work: (repositories: Repositories<D>, database: DatabaseSession) => T | Promise<T>,
  driver: Driver = "pgsql",
  services: readonly ServiceDeclaration[] = [],
): Promise<T> {
  return withBoundDatabase(
    {
      definition: {
        default: "main",
        connections: { main: { driver: "sqlite", filename: ":memory:" } },
        repositories: definitions,
      },
      connection,
      driver,
      services,
    },
    (database) => {
      const repositories = definitions.map((definition) =>
        database.repository(definition as never),
      ) as Repositories<D>;
      return work(repositories, database);
    },
  );
}

export type { BoundDatabaseFixture, DatabaseInvocation, SqlFixture };
export { syntheticRepositoryPool, withBoundDatabase, withRepositories };
