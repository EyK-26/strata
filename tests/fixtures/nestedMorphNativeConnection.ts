/** Installed native ORM fixture: one canonical owner; DDL uses the generated migration owner. */
import { afterEach } from "bun:test";
import assert from "node:assert/strict";
import type { OpenOutcome, ResourceSpec } from "@getstrata/core/contracts/application";
import { resourceService, type ServiceDeclaration } from "@getstrata/core/contracts/services";
import type { ServiceToken } from "@getstrata/core/contracts/token";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import { Schema } from "@getstrata/core/database/schema";
import type {
  DatabaseConnectionOptions,
  DatabaseSession,
  SqlStatement,
} from "@getstrata/core/database/session";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { createApplication } from "@getstrata/core/runtime/application";

interface NativeTransaction {
  execute: DatabaseSession["execute"];
  savepoint<T>(work: (child: NativeTransaction) => Promise<T>): Promise<unknown>;
}
interface NativePin {
  begin<T>(work: (child: NativeTransaction) => Promise<T>): Promise<unknown>;
  release(): Promise<unknown>;
  discard(): Promise<unknown>;
}
interface NativePool {
  readonly dialect: DatabaseSession["dialect"];
  readonly capabilities: DatabaseSession["capabilities"];
  execute: DatabaseSession["execute"];
  checkout(options: unknown): Promise<OpenOutcome<NativePin>>;
  close(): unknown;
}
interface NativeFixture {
  readonly definition: Parameters<typeof createDatabaseBindings>[0];
  readonly services?: readonly ServiceDeclaration[];
  readonly observe?: (statement: SqlStatement) => void;
  readonly schema: Parameters<typeof Schema.run>[2];
}
const pendingCloses = new Set<() => Promise<void>>();
afterEach(async () => {
  await Promise.all([...pendingCloses].map((close) => close()));
});
export async function withNestedMorphDatabase<T>(
  fixture: NativeFixture,
  work: (database: DatabaseSession) => T | Promise<T>,
): Promise<T> {
  const engine = process.env.QUALIFICATION_DATABASE;
  assert.ok(engine === "mysql" || engine === "postgres" || engine === "sqlite");
  const driver = engine === "postgres" ? "pgsql" : engine;
  const configured: {
    databaseOptions(env: Readonly<Record<string, string | undefined>>): DatabaseConnectionOptions;
  } = await import(new URL("./src/bootstrap/database.ts", import.meta.url).href);
  const migration: {
    withMigrationDatabase<T>(
      work: (connection: {
        unsafe<Row>(text: string, params?: readonly unknown[]): Promise<Row[]>;
      }) => Promise<T>,
    ): Promise<T>;
  } = await import(new URL("./src/db/migrationRuntime.ts", import.meta.url).href);
  const runSchema = (schema: Parameters<typeof Schema.run>[2]) =>
    migration.withMigrationDatabase((connection) => Schema.run(connection, driver, schema));
  const declarations = createDatabaseBindings({
    ...fixture.definition,
    default: "native",
    connections: { native: configured.databaseOptions(Object.freeze({ ...process.env })) },
  });
  const overrides = declarations
    .filter((item) => item.kind === "resource")
    .map((item) => {
      if (item.kind !== "resource") throw Error("Expected a canonical pool resource");
      return resourceService(item.token as ServiceToken<NativePool>, {
        lifetime: "application",
        dependencies: item.dependencies,
        create: (...dependencies) => {
          const descriptor = item.create(...(dependencies as never[])) as ResourceSpec<NativePool>;
          // Observe real native statements; every control receipt passes through unchanged.
          const tx = (native: NativeTransaction): NativeTransaction => ({
            execute: <R>(statement: SqlStatement) => {
              fixture.observe?.(statement);
              return native.execute<R>(statement);
            },
            savepoint: (callback) => native.savepoint((child) => callback(tx(child))),
          });
          const pin = (native: NativePin): NativePin => ({
            begin: (callback) => native.begin((child) => callback(tx(child))),
            release: () => native.release(),
            discard: () => native.discard(),
          });
          return {
            ...descriptor,
            open: async (signal) => {
              const outcome = await descriptor.open(signal);
              if (!outcome.ok) return outcome;
              const native = outcome.value;
              return {
                ok: true,
                value: {
                  dialect: native.dialect,
                  capabilities: native.capabilities,
                  execute: <R>(statement: SqlStatement) => {
                    fixture.observe?.(statement);
                    return native.execute<R>(statement);
                  },
                  checkout: async (options) => {
                    const selected = await native.checkout(options);
                    return selected.ok ? { ok: true, value: pin(selected.value) } : selected;
                  },
                  close: () => native.close(),
                },
              };
            },
          } satisfies ResourceSpec<NativePool>;
        },
      });
    });
  const app = createApplication({
    providers: [],
    services: [...declarations, ...(fixture.services ?? [])],
    overrides,
  });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      const result = await app.stop();
      assert.ok(result.successful, "Canonical native fixture cleanup must be confirmed");
    } finally {
      try {
        await runSchema((schema) => {
          for (const table of [
            "nested_comments",
            "nested_videos",
            "nested_articles",
            "nested_video_owners",
            "nested_article_owners",
          ])
            schema.drop(table);
        });
      } finally {
        pendingCloses.delete(close);
      }
    }
  };
  pendingCloses.add(close);
  try {
    await runSchema(fixture.schema);
    await app.start();
    return await app.run((scope) => work(scope.resolve(DATABASE_SESSION_TOKEN)));
  } finally {
    await close();
  }
}
