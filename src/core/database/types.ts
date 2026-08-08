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
};

type QueryFilterValue =
  DatabaseScalar | readonly DatabaseScalar[] | QueryOperator;
type QueryWhere<TEntity> = Partial<
  Record<keyof TEntity & string, QueryFilterValue>
>;

type QueryOrder<TEntity> = {
  column: keyof TEntity & string;
  direction?: "ASC" | "DESC" | "asc" | "desc";
};

interface QueryOptions<TEntity> {
  where?: QueryWhere<TEntity>;
  orderBy?: QueryOrder<TEntity> | QueryOrder<TEntity>[];
  limit?: number;
  offset?: number;
  withTrashed?: boolean;
  onlyTrashed?: boolean;
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
  QueryOperator,
  QueryOptions,
  QueryOrder,
  QueryWhere,
  UpdateValues,
};
