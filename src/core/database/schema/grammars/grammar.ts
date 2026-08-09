import type { Blueprint } from "../blueprint.ts";
import type { ColumnDefinition } from "../columnDefinition.ts";
import type { DatabaseDriver } from "../driver.ts";

interface Grammar {
  readonly driver: DatabaseDriver;
  compile(blueprint: Blueprint): string[];
}

function compileColumnType(driver: DatabaseDriver, column: ColumnDefinition): string {
  switch (column.kind) {
    case "id":
      return compileIdType(driver);
    case "string":
      return compileStringType(driver, column.length);
    case "text":
      return compileTextType(driver);
    case "boolean":
      return compileBooleanType(driver);
    case "integer":
    case "foreignId":
      return compileIntegerType(driver);
    case "bigInteger":
      return compileBigIntegerType(driver);
    case "timestamp":
      return compileTimestampType(driver);
    case "json":
      return compileJsonType(driver);
    case "jsonb":
      return compileJsonbType(driver);
    default:
      throw new Error(`Unsupported column kind: ${column.kind satisfies never}`);
  }
}

function compileIdType(driver: DatabaseDriver): string {
  switch (driver) {
    case "pgsql":
      return "SERIAL";
    case "mysql":
      return "BIGINT UNSIGNED";
    case "sqlite":
      return "INTEGER";
  }
}

function compileStringType(driver: DatabaseDriver, length?: number): string {
  switch (driver) {
    case "pgsql":
      return "TEXT";
    case "mysql":
      return length ? `VARCHAR(${length})` : "VARCHAR(255)";
    case "sqlite":
      return "TEXT";
  }
}

function compileTextType(driver: DatabaseDriver): string {
  switch (driver) {
    case "pgsql":
    case "sqlite":
      return "TEXT";
    case "mysql":
      return "TEXT";
  }
}

function compileBooleanType(driver: DatabaseDriver): string {
  switch (driver) {
    case "pgsql":
      return "BOOLEAN";
    case "mysql":
      return "BOOLEAN";
    case "sqlite":
      return "INTEGER";
  }
}

function compileIntegerType(driver: DatabaseDriver): string {
  switch (driver) {
    case "pgsql":
      return "INTEGER";
    case "mysql":
      return "INT";
    case "sqlite":
      return "INTEGER";
  }
}

function compileBigIntegerType(driver: DatabaseDriver): string {
  switch (driver) {
    case "pgsql":
      return "BIGINT";
    case "mysql":
      return "BIGINT";
    case "sqlite":
      return "INTEGER";
  }
}

function compileTimestampType(driver: DatabaseDriver): string {
  switch (driver) {
    case "pgsql":
      return "TIMESTAMPTZ";
    case "mysql":
      return "TIMESTAMP";
    case "sqlite":
      return "TEXT";
  }
}

function compileJsonType(driver: DatabaseDriver): string {
  switch (driver) {
    case "pgsql":
      return "JSONB";
    case "mysql":
      return "JSON";
    case "sqlite":
      return "TEXT";
  }
}

function compileJsonbType(driver: DatabaseDriver): string {
  switch (driver) {
    case "pgsql":
      return "JSONB";
    case "mysql":
      return "JSON";
    case "sqlite":
      return "TEXT";
  }
}

export type { Grammar };
export { compileColumnType };
