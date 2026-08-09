import { ColumnDefinition, ForeignIdColumnDefinition } from "./columnDefinition.ts";

type IndexKind = "index" | "unique" | "partial" | "uniquePartial" | "fullText" | "gin";

interface IndexDefinition {
  name?: string;
  columns: string[];
  kind: IndexKind;
  where?: string;
  order?: "asc" | "desc";
}

type BlueprintAction = "create" | "alter" | "drop";

class Blueprint {
  readonly table: string;
  readonly action: BlueprintAction;
  readonly columns: ColumnDefinition[] = [];
  readonly indexes: IndexDefinition[] = [];
  readonly droppedColumns: string[] = [];
  readonly droppedIndexes: string[] = [];

  constructor(table: string, action: BlueprintAction) {
    this.table = table;
    this.action = action;
  }

  id(name = "id"): ColumnDefinition {
    const column = new ColumnDefinition(name, "id");
    column.primary();
    column.autoIncrement = true;
    this.columns.push(column);
    return column;
  }

  string(name: string, length?: number): ColumnDefinition {
    const column = new ColumnDefinition(name, "string");
    column.length = length;
    column.notNullable();
    this.columns.push(column);
    return column;
  }

  text(name: string): ColumnDefinition {
    const column = new ColumnDefinition(name, "text");
    column.notNullable();
    this.columns.push(column);
    return column;
  }

  boolean(name: string): ColumnDefinition {
    const column = new ColumnDefinition(name, "boolean");
    column.notNullable();
    this.columns.push(column);
    return column;
  }

  integer(name: string): ColumnDefinition {
    const column = new ColumnDefinition(name, "integer");
    column.notNullable();
    this.columns.push(column);
    return column;
  }

  bigInteger(name: string): ColumnDefinition {
    const column = new ColumnDefinition(name, "bigInteger");
    column.notNullable();
    this.columns.push(column);
    return column;
  }

  timestamp(name: string): ColumnDefinition {
    const column = new ColumnDefinition(name, "timestamp");
    column.notNullable();
    this.columns.push(column);
    return column;
  }

  json(name: string): ColumnDefinition {
    const column = new ColumnDefinition(name, "json");
    column.notNullable();
    this.columns.push(column);
    return column;
  }

  jsonb(name: string): ColumnDefinition {
    const column = new ColumnDefinition(name, "jsonb");
    column.notNullable();
    this.columns.push(column);
    return column;
  }

  foreignId(name: string): ForeignIdColumnDefinition {
    const column = new ForeignIdColumnDefinition(name);
    this.columns.push(column);
    return column;
  }

  timestamps(): void {
    this.timestamp("created_at").defaultRaw("NOW()");
    this.timestamp("updated_at").defaultRaw("NOW()");
  }

  softDeletes(): void {
    this.timestamp("deleted_at").nullable();
  }

  dropColumn(name: string): void {
    this.droppedColumns.push(name);
  }

  dropSoftDeletes(): void {
    this.dropColumn("deleted_at");
    this.dropIndex(`idx_${this.table}_deleted_at`);
  }

  dropIndex(name: string): void {
    this.droppedIndexes.push(name);
  }

  unique(columns: string | string[], name?: string): void {
    this.indexes.push({
      name,
      columns: Array.isArray(columns) ? columns : [columns],
      kind: "unique",
    });
  }

  index(columns: string | string[], options: { name?: string; order?: "asc" | "desc" } = {}): void {
    this.indexes.push({
      name: options.name,
      columns: Array.isArray(columns) ? columns : [columns],
      kind: "index",
      order: options.order,
    });
  }

  partialIndex(
    columns: string | string[],
    where: string,
    nameOrOptions?: string | { name?: string; unique?: boolean },
  ): void {
    const options =
      typeof nameOrOptions === "string" ? { name: nameOrOptions } : (nameOrOptions ?? {});

    this.indexes.push({
      name: options.name,
      columns: Array.isArray(columns) ? columns : [columns],
      kind: options.unique ? "uniquePartial" : "partial",
      where,
    });
  }

  fullText(columns: string | string[], name?: string): void {
    this.indexes.push({
      name,
      columns: Array.isArray(columns) ? columns : [columns],
      kind: "fullText",
    });
  }

  ginIndex(column: string, name?: string): void {
    this.indexes.push({
      name,
      columns: [column],
      kind: "gin",
    });
  }
}

export type { BlueprintAction, IndexDefinition, IndexKind };
export { Blueprint };
