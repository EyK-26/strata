import type { WhereNode } from "./whereBuilder.ts";

type DatabaseComparable = string | number | Date;
type DatabaseScalar = DatabaseComparable | boolean | null;

type QueryOperator = {
  eq?: DatabaseScalar;
  ne?: DatabaseScalar;
  in?: readonly DatabaseScalar[];
  notIn?: readonly DatabaseScalar[];
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

/** Ordinary model filters constrain keys and operators to their declared scalar values. */
type ModelFilterScalar<T> = unknown extends T ? DatabaseScalar : Extract<T, DatabaseScalar>;
type ModelFilterOperator<T> = {
  eq?: ModelFilterScalar<T>;
  ne?: ModelFilterScalar<T>;
  in?: readonly ModelFilterScalar<T>[];
  notIn?: readonly ModelFilterScalar<T>[];
  gt?: Extract<ModelFilterScalar<T>, DatabaseComparable>;
  gte?: Extract<ModelFilterScalar<T>, DatabaseComparable>;
  lt?: Extract<ModelFilterScalar<T>, DatabaseComparable>;
  lte?: Extract<ModelFilterScalar<T>, DatabaseComparable>;
  isNull?: boolean;
} & (Extract<T, string> extends never ? unknown : { ilike?: string; tsMatch?: string });
type ModelWhere<TEntity> = string extends keyof TEntity
  ? QueryWhere<TEntity>
  : {
      [K in keyof TEntity & string]?:
        | ModelFilterScalar<TEntity[K]>
        | readonly ModelFilterScalar<TEntity[K]>[]
        | ModelFilterOperator<TEntity[K]>;
    };
/** Omission stays legal: DB defaults, generated columns and fillable/timestamp policy are runtime concerns. */
type ModelWriteValues<TEntity> = Partial<TEntity>;

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
  | { kind: "subqueryCount"; sql: string; params: readonly unknown[]; as: string }
  | { kind: "tsRank"; table: string; column: string; query: string; as: string };

interface QueryOptions<TEntity extends object> {
  whereNodes?: WhereNode<TEntity>[];
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
  ModelWhere,
  ModelWriteValues,
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
