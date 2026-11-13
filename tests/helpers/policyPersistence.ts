import { createPersistenceInvocation } from "@getstrata/bootstrap/persistenceInvocation";
import type { ExecutionEnvelope } from "@getstrata/core/contracts/application";
import type { ExecutionPersistence } from "@getstrata/core/contracts/persistence";
import { resourceService } from "@getstrata/core/contracts/services";
import type { ServiceToken } from "@getstrata/core/contracts/token";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import { createApplication } from "@getstrata/core/runtime/application";
import type { RawPool } from "../../src/core/database/driverPorts";
import { type SqlFixture, syntheticRepositoryPool } from "./boundRepositoryHarness";

/** SQL-shape unit fixture; synthetic ACKs do not claim native transaction behavior. */
export async function withPolicyPersistence<T>(
  connection: SqlFixture,
  work: (ports: ExecutionPersistence) => T | Promise<T>,
  options: {
    driver?: "pgsql" | "mysql" | "sqlite";
    envelope?: ExecutionEnvelope;
  } = {},
): Promise<T> {
  const declarations = createDatabaseBindings({
    default: "main",
    connections: { main: { driver: "sqlite", filename: ":memory:" } },
  });
  const pool = declarations.find((entry) => entry.kind === "resource");
  if (pool?.kind !== "resource") throw new Error("Missing fixture pool declaration.");
  const application = createApplication({
    providers: [],
    services: declarations,
    overrides: [
      resourceService(pool.token as ServiceToken<RawPool>, {
        lifetime: "application",
        dependencies: pool.dependencies,
        create: () => ({
          name: "policy-sql-fixture",
          open: () => ({
            ok: true,
            value: syntheticRepositoryPool(connection, options.driver ?? "pgsql"),
          }),
          close: () => {},
        }),
      }),
    ],
  });
  let value: T | undefined;
  let failed = false;
  let failure: unknown;
  try {
    await application.start();
    value = await createPersistenceInvocation(application, "main")(
      options.envelope ?? {
        kind: "command",
        actor: { kind: "system", policy: "policy-unit-fixture" },
      },
      work,
    );
  } catch (error) {
    failed = true;
    failure = error;
  }
  const stopped = await application.stop();
  if (!stopped.successful)
    throw new AggregateError(
      [...(failed ? [failure] : []), new Error("Policy fixture application did not stop cleanly.")],
      "Policy fixture failed cleanup.",
    );
  if (failed) throw failure;
  return value as T;
}
