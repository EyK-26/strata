import type { QueryWhere } from "./types.ts";

type ExistsClause = {
  sql: string;
  params: readonly unknown[];
  not?: boolean;
};

type WhereNode<TEntity extends object> =
  | { kind: "and" | "or"; where: QueryWhere<TEntity> }
  | { kind: "and" | "or"; group: WhereNode<TEntity>[] }
  | { kind: "and" | "or"; exists: ExistsClause };

class WhereBuilder<TEntity extends object> {
  readonly nodes: WhereNode<TEntity>[] = [];

  where(where: QueryWhere<TEntity>): this {
    this.nodes.push({ kind: "and", where });
    return this;
  }

  orWhere(where: QueryWhere<TEntity>): this {
    this.nodes.push({ kind: "or", where });
    return this;
  }

  whereGroup(fn: (builder: WhereBuilder<TEntity>) => void): this {
    const nested = new WhereBuilder<TEntity>();
    fn(nested);

    if (nested.nodes.length > 0) {
      this.nodes.push({ kind: "and", group: nested.nodes });
    }

    return this;
  }

  orWhereGroup(fn: (builder: WhereBuilder<TEntity>) => void): this {
    const nested = new WhereBuilder<TEntity>();
    fn(nested);

    if (nested.nodes.length > 0) {
      this.nodes.push({ kind: "or", group: nested.nodes });
    }

    return this;
  }
}

export type { ExistsClause, WhereNode };
export { WhereBuilder };
