type ColumnKind =
  | "id"
  | "string"
  | "text"
  | "boolean"
  | "integer"
  | "bigInteger"
  | "timestamp"
  | "json"
  | "jsonb"
  | "foreignId";

interface ForeignKeyOptions {
  referencesTable: string;
  referencesColumn: string;
  onDelete?: "cascade" | "set null" | "restrict";
}

class ColumnDefinition {
  readonly name: string;
  kind: ColumnKind;
  length?: number;
  isNullable = false;
  isPrimary = false;
  isUnique = false;
  autoIncrement = false;
  defaultValue?: string;
  checkExpression?: string;
  foreignKey?: ForeignKeyOptions;

  constructor(name: string, kind: ColumnKind) {
    this.name = name;
    this.kind = kind;
  }

  nullable(): this {
    this.isNullable = true;
    return this;
  }

  notNullable(): this {
    this.isNullable = false;
    return this;
  }

  default(value: string | number | boolean): this {
    if (typeof value === "boolean") {
      this.defaultValue = value ? "TRUE" : "FALSE";
      return this;
    }

    if (typeof value === "number") {
      this.defaultValue = String(value);
      return this;
    }

    this.defaultValue = `'${value.replace(/'/g, "''")}'`;
    return this;
  }

  defaultRaw(expression: string): this {
    this.defaultValue = expression;
    return this;
  }

  unique(): this {
    this.isUnique = true;
    return this;
  }

  primary(): this {
    this.isPrimary = true;
    return this;
  }

  check(expression: string): this {
    this.checkExpression = expression;
    return this;
  }
}

class ForeignIdColumnDefinition extends ColumnDefinition {
  constructor(name: string) {
    super(name, "foreignId");
    this.notNullable();
  }

  references(table: string, column = "id"): this {
    this.foreignKey = {
      referencesTable: table,
      referencesColumn: column,
    };
    return this;
  }

  constrained(table?: string): this {
    const referencesTable = table ?? inferReferencedTable(this.name);
    return this.references(referencesTable);
  }

  cascadeOnDelete(): this {
    if (!this.foreignKey) {
      throw new Error(`Foreign key is not defined for column ${this.name}`);
    }

    this.foreignKey.onDelete = "cascade";
    return this;
  }

  nullOnDelete(): this {
    if (!this.foreignKey) {
      throw new Error(`Foreign key is not defined for column ${this.name}`);
    }

    this.foreignKey.onDelete = "set null";
    return this;
  }
}

function inferReferencedTable(columnName: string): string {
  if (!columnName.endsWith("_id")) {
    throw new Error(`Cannot infer referenced table from column ${columnName}`);
  }

  return columnName.slice(0, -3);
}

export type { ColumnKind, ForeignKeyOptions };
export { ColumnDefinition, ForeignIdColumnDefinition, inferReferencedTable };
