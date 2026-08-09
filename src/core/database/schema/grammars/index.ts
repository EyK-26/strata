import type { DatabaseDriver } from "../driver.ts";
import type { Grammar } from "./grammar.ts";
import { MySqlGrammar } from "./mysqlGrammar.ts";
import { PostgresGrammar } from "./postgresGrammar.ts";
import { SqliteGrammar } from "./sqliteGrammar.ts";

function grammarForDriver(driver: DatabaseDriver): Grammar {
  switch (driver) {
    case "pgsql":
      return PostgresGrammar;
    case "mysql":
      return MySqlGrammar;
    case "sqlite":
      return SqliteGrammar;
    default:
      throw new Error(`Unsupported database driver: ${driver satisfies never}`);
  }
}

export { grammarForDriver, MySqlGrammar, PostgresGrammar, SqliteGrammar };
