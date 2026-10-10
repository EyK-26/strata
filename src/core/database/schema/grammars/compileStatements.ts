import { dialectFor } from "../../dialect.ts";
import type { Blueprint, IndexDefinition } from "../blueprint.ts";
import type { ColumnDefinition } from "../columnDefinition.ts";
import type { DatabaseDriver } from "../driver.ts";
import { UnsupportedSchemaFeatureError } from "../errors.ts";
import { compileColumnType } from "./grammar.ts";

function compileTableConstraints(driver: DatabaseDriver, blueprint: Blueprint): string[] {
  const quoteIdentifier = dialectFor(driver).quoteIdentifier;
  const named = (name?: string) => (name ? `CONSTRAINT ${quoteIdentifier(name)} ` : "");
  const columns = (names: string[]) => names.map(quoteIdentifier).join(", ");
  return [
    ...blueprint.foreignKeys.map((key) => {
      const deletion = key.onDelete ? ` ON DELETE ${key.onDelete.toUpperCase()}` : "";
      return `${named(key.name)}FOREIGN KEY (${columns(key.columns)}) REFERENCES ${quoteIdentifier(key.referencesTable)}(${columns(key.referencesColumns)})${deletion}`;
    }),
    ...blueprint.checks.map((check) => `${named(check.name)}CHECK (${check.expression})`),
  ];
}

function compileCreateTable(driver: DatabaseDriver, blueprint: Blueprint): string[] {
  const quoteIdentifier = dialectFor(driver).quoteIdentifier;
  const table = quoteIdentifier(blueprint.table);
  const parts = blueprint.columns.map((column) => compileColumn(driver, column, "create"));

  for (const index of blueprint.indexes) {
    if (index.kind === "unique") {
      const columns = index.columns.map((column) => quoteIdentifier(column)).join(", ");
      const name = index.name ? `CONSTRAINT ${quoteIdentifier(index.name)} ` : "";
      parts.push(`${name}UNIQUE (${columns})`);
    }
  }

  parts.push(...compileTableConstraints(driver, blueprint));

  const statements = [`CREATE TABLE IF NOT EXISTS ${table} (\n  ${parts.join(",\n  ")}\n)`];

  for (const index of blueprint.indexes) {
    if (index.kind === "unique" && index.columns.length === 1) {
      continue;
    }

    if (index.kind === "index") {
      statements.push(compileIndex(driver, blueprint.table, index));
    } else if (
      index.kind === "partial" ||
      index.kind === "uniquePartial" ||
      index.kind === "gin" ||
      index.kind === "fullText"
    ) {
      statements.push(...compileSpecialIndex(driver, blueprint.table, index));
    }
  }

  return statements;
}

function compileAlterTable(driver: DatabaseDriver, blueprint: Blueprint): string[] {
  const quoteIdentifier = dialectFor(driver).quoteIdentifier;
  const statements: string[] = [];
  const table = quoteIdentifier(blueprint.table);

  for (const column of blueprint.columns) {
    const addPrefix = driver === "pgsql" ? "ADD COLUMN IF NOT EXISTS" : "ADD COLUMN";
    statements.push(`ALTER TABLE ${table}\n${addPrefix} ${compileColumn(driver, column, "alter")}`);
  }

  if (blueprint.foreignKeys.length || blueprint.checks.length) {
    if (driver === "sqlite") {
      throw new UnsupportedSchemaFeatureError(
        "adding table constraints; rebuild the SQLite table",
        driver,
      );
    }
    for (const constraint of compileTableConstraints(driver, blueprint)) {
      statements.push(`ALTER TABLE ${table} ADD ${constraint}`);
    }
  }

  for (const columnName of blueprint.droppedColumns) {
    const dropPrefix = driver === "pgsql" ? "DROP COLUMN IF EXISTS" : "DROP COLUMN";
    statements.push(`ALTER TABLE ${table} ${dropPrefix} ${quoteIdentifier(columnName)}`);
  }

  for (const indexName of blueprint.droppedIndexes) {
    statements.push(
      driver === "mysql"
        ? `DROP INDEX ${quoteIdentifier(indexName)} ON ${table}`
        : `DROP INDEX IF EXISTS ${quoteIdentifier(indexName)}`,
    );
  }

  for (const index of blueprint.indexes) {
    if (index.kind === "index" || index.kind === "unique") {
      statements.push(compileIndex(driver, blueprint.table, index));
    } else {
      statements.push(...compileSpecialIndex(driver, blueprint.table, index));
    }
  }

  return statements;
}

function compileDropTable(driver: DatabaseDriver, tableName: string): string[] {
  const quoteIdentifier = dialectFor(driver).quoteIdentifier;
  const cascade = driver === "pgsql" ? " CASCADE" : "";
  return [`DROP TABLE IF EXISTS ${quoteIdentifier(tableName)}${cascade}`];
}

function compileColumn(
  driver: DatabaseDriver,
  column: ColumnDefinition,
  mode: "create" | "alter",
): string {
  const quoteIdentifier = dialectFor(driver).quoteIdentifier;
  const parts = [quoteIdentifier(column.name), compileColumnType(driver, column)];

  if (column.autoIncrement && driver === "mysql") {
    parts[1] = `${parts[1]} AUTO_INCREMENT`;
  }

  if (column.isPrimary && mode === "create") {
    if (driver === "sqlite" && column.autoIncrement) {
      parts.push("PRIMARY KEY AUTOINCREMENT");
    } else {
      parts.push(
        driver === "sqlite" && !column.isNullable ? "PRIMARY KEY NOT NULL" : "PRIMARY KEY",
      );
    }
  } else if (!column.isNullable) {
    parts.push("NOT NULL");
  } else if (column.isNullable) {
    parts.push("NULL");
  }

  if (column.defaultValue !== undefined) {
    parts.push(`DEFAULT ${column.defaultValue}`);
  }

  if (column.isUnique) {
    parts.push("UNIQUE");
  }

  if (column.checkExpression) {
    parts.push(`CHECK (${column.checkExpression})`);
  }

  if (column.foreignKey) {
    const { referencesTable, referencesColumn, onDelete } = column.foreignKey;
    const reference = `${quoteIdentifier(referencesTable)}(${quoteIdentifier(referencesColumn)})`;
    let clause = `REFERENCES ${reference}`;

    if (onDelete === "cascade") {
      clause += " ON DELETE CASCADE";
    } else if (onDelete === "set null") {
      clause += " ON DELETE SET NULL";
    }

    parts.push(clause);
  }

  return parts.join(" ");
}

function compileIndex(driver: DatabaseDriver, tableName: string, index: IndexDefinition): string {
  const quoteIdentifier = dialectFor(driver).quoteIdentifier;
  const indexName =
    index.name ??
    defaultIndexName(tableName, index.columns, index.kind === "unique" ? "unique" : "index");
  const columns = index.columns
    .map((column) => {
      const quoted = quoteIdentifier(column);
      if (index.order === "desc") {
        return `${quoted} DESC`;
      }

      return quoted;
    })
    .join(", ");
  const unique = index.kind === "unique" ? "UNIQUE " : "";

  const existence = driver === "mysql" ? "" : "IF NOT EXISTS ";
  return `CREATE ${unique}INDEX ${existence}${quoteIdentifier(indexName)} ON ${quoteIdentifier(tableName)}(${columns})`;
}

function compileSpecialIndex(
  driver: DatabaseDriver,
  tableName: string,
  index: IndexDefinition,
): string[] {
  const quoteIdentifier = dialectFor(driver).quoteIdentifier;
  const indexName = index.name ?? defaultIndexName(tableName, index.columns, index.kind);
  const columns = index.columns.map((column) => quoteIdentifier(column)).join(", ");

  switch (index.kind) {
    case "partial":
    case "uniquePartial": {
      if (driver !== "pgsql") {
        throw new UnsupportedSchemaFeatureError("partialIndex()", driver);
      }

      const unique = index.kind === "uniquePartial" ? "UNIQUE " : "";
      return [
        `CREATE ${unique}INDEX IF NOT EXISTS ${quoteIdentifier(indexName)} ON ${quoteIdentifier(tableName)}(${columns}) WHERE ${index.where}`,
      ];
    }
    case "gin": {
      if (driver !== "pgsql") {
        throw new UnsupportedSchemaFeatureError("ginIndex()", driver);
      }

      return [
        `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(indexName)} ON ${quoteIdentifier(tableName)} USING GIN(${columns})`,
      ];
    }
    case "fullText": {
      if (driver === "mysql") {
        return [
          `CREATE FULLTEXT INDEX ${quoteIdentifier(indexName)} ON ${quoteIdentifier(tableName)}(${columns})`,
        ];
      }

      if (driver === "pgsql") {
        throw new UnsupportedSchemaFeatureError(
          "fullText(); use ginIndex() with a tsvector column on PostgreSQL",
          driver,
        );
      }

      throw new UnsupportedSchemaFeatureError("fullText()", driver);
    }
    default:
      return [];
  }
}

function defaultIndexName(tableName: string, columns: string[], kind: string): string {
  return `idx_${tableName}_${columns.join("_")}_${kind}`;
}

function compileBlueprint(driver: DatabaseDriver, blueprint: Blueprint): string[] {
  switch (blueprint.action) {
    case "create":
      return compileCreateTable(driver, blueprint);
    case "alter":
      return compileAlterTable(driver, blueprint);
    case "drop":
      return compileDropTable(driver, blueprint.table);
    default:
      throw new Error(`Unsupported blueprint action: ${blueprint.action satisfies never}`);
  }
}

export { compileBlueprint, compileColumn, compileDropTable, compileIndex };
