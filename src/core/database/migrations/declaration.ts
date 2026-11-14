import { currentSqlDialect } from "../dialect";
import { Schema, type SchemaBuilder } from "../schema/schema";
import type { Migration, MigrationDatabase, MigrationDownContext } from "./types";

interface MigrationDeclaration {
  readonly name: string;
  readonly up: (schema: SchemaBuilder, db: MigrationDatabase) => void | Promise<void>;
  readonly down: (
    schema: SchemaBuilder,
    db: MigrationDatabase,
    context?: MigrationDownContext,
  ) => void | Promise<void>;
}
/** The runner owns the database and dialect; declarations describe only schema changes. */
function defineMigration(declaration: MigrationDeclaration): Migration {
  const { name, up, down } = declaration;
  if (
    typeof name !== "string" ||
    !name.trim() ||
    typeof up !== "function" ||
    typeof down !== "function"
  )
    throw new TypeError("Migrations require a name and up/down callbacks.");
  return Object.freeze({
    name,
    up: async (db: MigrationDatabase) =>
      Schema.run(db, currentSqlDialect().driver, (schema) => up(schema, db)),
    down: async (db: MigrationDatabase, context?: MigrationDownContext) =>
      Schema.run(db, currentSqlDialect().driver, (schema) => down(schema, db, context)),
  });
}

export type { MigrationDeclaration };
export { defineMigration };
