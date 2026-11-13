import { createPersistenceInvocation } from "../bootstrap/persistenceInvocation";
import { createDatabaseBindings } from "../core/database/bindings";
import { runWithSqlDialect } from "../core/database/dialect";
import type { MigrationDatabase } from "../core/database/migrations/types";
import { isProductionEnv } from "../core/runtime/appEnv";
import { createApplication } from "../core/runtime/application";

export interface FixtureSchemaOptions {
  databaseUrl?: string;
}
export const FIXTURE_SCHEMA_LOCK_KEY = 42_424_242;

/** Private fixture target, never the generated application's runtime/admin URL precedence. */
export function fixtureDatabaseUrl(options: FixtureSchemaOptions = {}): string {
  if (isProductionEnv())
    throw new Error(
      "Framework fixture commands are disabled outside development/test environments.",
    );
  const value = (options.databaseUrl ?? process.env.DATABASE_URL)?.trim();
  if (!value) throw new Error("Fixture DATABASE_URL is required.");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Fixture DATABASE_URL must be a PostgreSQL database URL.");
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !parsed.pathname ||
    parsed.pathname === "/"
  )
    throw new Error("Fixture DATABASE_URL must be a PostgreSQL database URL.");
  return value;
}

/** One canonical pinned PostgreSQL transaction owns schema, history and optional seed rows. */
export async function withFixtureSchema<T>(
  work: (database: MigrationDatabase) => Promise<T>,
  options: FixtureSchemaOptions = {},
): Promise<T> {
  const url = fixtureDatabaseUrl(options);
  const application = createApplication({
    providers: [],
    services: createDatabaseBindings({
      default: "main",
      connections: { main: { driver: "pgsql", url } },
    }),
  });
  const invoke = createPersistenceInvocation(application, "main");
  const failures: unknown[] = [];
  let result!: T;
  try {
    await application.start();
    result = await runWithSqlDialect("pgsql", () =>
      invoke(
        { kind: "command", actor: { kind: "system", policy: "fixture.schema-command" } },
        ({ database, policy }) =>
          policy.run(database, { kind: "bypass" }, async (selected) => {
            await selected.execute({
              text: "SELECT pg_advisory_xact_lock($1)",
              params: [FIXTURE_SCHEMA_LOCK_KEY],
            });
            const executor: MigrationDatabase = {
              unsafe: async <Row>(text: string, params: readonly unknown[] = []) => [
                ...(await selected.execute<Row>({ text, params })),
              ],
            };
            return work(executor);
          }),
      ),
    );
  } catch (error) {
    failures.push(error);
  }
  try {
    const stopped = await application.stop({ reason: "fixture schema command complete" });
    if (!stopped.successful)
      failures.push(new Error("Fixture schema owner cleanup failed.", { cause: stopped }));
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "Fixture schema command and cleanup failed.");
  return result;
}
