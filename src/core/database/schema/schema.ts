import type { MigrationDatabase } from "../migrations/types.ts";
import { Blueprint } from "./blueprint.ts";
import type { DatabaseDriver } from "./driver.ts";
import { resolveDatabaseDriver } from "./driver.ts";
import { grammarForDriver } from "./grammars/index.ts";

type BlueprintCallback = (table: Blueprint) => void;

class SchemaBuilder {
  readonly #driver: DatabaseDriver;
  readonly #statements: string[] = [];

  constructor(driver: DatabaseDriver) {
    this.#driver = driver;
  }

  create(table: string, callback: BlueprintCallback): this {
    const blueprint = new Blueprint(table, "create");
    callback(blueprint);
    this.#statements.push(...grammarForDriver(this.#driver).compile(blueprint));
    return this;
  }

  table(table: string, callback: BlueprintCallback): this {
    const blueprint = new Blueprint(table, "alter");
    callback(blueprint);
    this.#statements.push(...grammarForDriver(this.#driver).compile(blueprint));
    return this;
  }

  drop(table: string): this {
    const blueprint = new Blueprint(table, "drop");
    this.#statements.push(...grammarForDriver(this.#driver).compile(blueprint));
    return this;
  }

  toSql(): string[] {
    return [...this.#statements];
  }

  async execute(db: MigrationDatabase): Promise<void> {
    for (const statement of this.#statements) {
      await db.unsafe(statement);
    }
  }
}

class Schema {
  static builder(driver?: DatabaseDriver): SchemaBuilder {
    return new SchemaBuilder(driver ?? resolveDatabaseDriver());
  }

  static async run(
    db: MigrationDatabase,
    driver: DatabaseDriver,
    callback: (schema: SchemaBuilder) => void | Promise<void>,
  ): Promise<void> {
    const schema = Schema.builder(driver);
    await callback(schema);
    await schema.execute(db);
  }
}

function createSchemaBuilder(db: MigrationDatabase, driver?: DatabaseDriver): SchemaBuilder {
  const builder = Schema.builder(driver);
  return Object.assign(builder, {
    async commit(): Promise<void> {
      await builder.execute(db);
    },
  });
}

export type { BlueprintCallback };
export { createSchemaBuilder, resolveDatabaseDriver, Schema, SchemaBuilder };
