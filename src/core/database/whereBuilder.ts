import type { QueryWhere } from "./types.ts";

type ExistsClause = {
  sql: string;
  params: readonly unknown[];
  not?: boolean;
};

type WhereNode<TEntity extends object> =
  | { kind: "and" | "or"; where: QueryWhere<TEntity> }
  | { kind: "and" | "or"; group: WhereNode<TEntity>[] }
  | { kind: "and" | "or"; exists: ExistsClause }
  | {
      kind: "and" | "or";
      compareRow: {
        columns: readonly string[];
        operator: "lt" | "gt";
        values: readonly unknown[];
      };
    };

class WhereBuilder<TEntity extends object, TWhere extends object = QueryWhere<TEntity>> {
  readonly nodes: WhereNode<TEntity>[] = [];

  where(where: TWhere): this {
    this.nodes.push({ kind: "and", where: where as QueryWhere<TEntity> });
    return this;
  }

  orWhere(where: TWhere): this {
    this.nodes.push({ kind: "or", where: where as QueryWhere<TEntity> });
    return this;
  }

  whereGroup(fn: (builder: WhereBuilder<TEntity, TWhere>) => void): this {
    const nested = new WhereBuilder<TEntity, TWhere>();
    fn(nested);

    if (nested.nodes.length > 0) {
      this.nodes.push({ kind: "and", group: nested.nodes });
    }

    return this;
  }

  orWhereGroup(fn: (builder: WhereBuilder<TEntity, TWhere>) => void): this {
    const nested = new WhereBuilder<TEntity, TWhere>();
    fn(nested);

    if (nested.nodes.length > 0) {
      this.nodes.push({ kind: "or", group: nested.nodes });
    }

    return this;
  }
}

export type { ExistsClause, WhereNode };
export { WhereBuilder };
