type DatabaseComparable = string | number | Date;
type DatabaseScalar = DatabaseComparable | boolean | null;

type QueryOperator = {
  eq?: DatabaseScalar;
  in?: readonly DatabaseScalar[];
  gt?: DatabaseComparable;
  gte?: DatabaseComparable;
  lt?: DatabaseComparable;
  lte?: DatabaseComparable;
  isNull?: boolean;
  ilike?: string;
  tsMatch?: string;
};

type QueryFilterValue = DatabaseScalar | readonly DatabaseScalar[] | QueryOperator;
type QueryWhere<TEntity> = Partial<Record<keyof TEntity & string, QueryFilterValue>> &
  Partial<Record<string, QueryFilterValue>>;

type QueryOrder<TEntity> = {
  column: keyof TEntity & string;
  direction?: "ASC" | "DESC" | "asc" | "desc";
};

type QueryOrderShorthand<TEntity> = Partial<
  Record<keyof TEntity & string, "ASC" | "DESC" | "asc" | "desc">
>;

type QueryJoinOn = {
  left: { table: string; column: string };
  right: { table: string; column: string };
};

type QueryJoin = {
  type: "inner" | "left";
  table: string;
  on: QueryJoinOn[];
};

type QuerySelectItem =
  | { kind: "column"; table: string; column: string; as?: string }
  | { kind: "literalText"; value: string; as: string }
  | { kind: "tsRank"; table: string; column: string; query: string; as: string };

interface QueryOptions<TEntity> {
  where?: QueryWhere<TEntity>;
  orderBy?: QueryOrder<TEntity> | QueryOrder<TEntity>[] | QueryOrderShorthand<TEntity>;
  limit?: number;
  offset?: number;
  withTrashed?: boolean;
  onlyTrashed?: boolean;
  joins?: QueryJoin[];
  groupBy?: string | string[];
  having?: QueryWhere<TEntity>;
  select?: QuerySelectItem[];
}

type MutationValues<TEntity> = Partial<TEntity>;
type UpdateValues<
  TEntity,
  PrimaryKey extends keyof TEntity & string = keyof TEntity & string,
> = Partial<Omit<TEntity, PrimaryKey>>;

export type {
  DatabaseComparable,
  DatabaseScalar,
  MutationValues,
  QueryFilterValue,
  QueryJoin,
  QueryJoinOn,
  QueryOperator,
  QueryOptions,
  QueryOrder,
  QuerySelectItem,
  QueryWhere,
  UpdateValues,
};
