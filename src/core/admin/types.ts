import type { PaginatedResult } from "../pagination/index.ts";

type AdminColumnType = "text" | "number" | "boolean" | "datetime" | "code";

interface AdminColumn {
  key: string;
  label: string;
  type?: AdminColumnType;
}

interface AdminResourceHandlers<TEntity extends object> {
  paginate(options: { page: number; perPage: number }): Promise<PaginatedResult<TEntity>>;
  findById?(id: number): Promise<TEntity | null>;
}

interface AdminResourceDefinition {
  name: string;
  label: string;
  labelPlural: string;
  columns: AdminColumn[];
}

interface AdminResource<TEntity extends object> extends AdminResourceDefinition {
  handlers: AdminResourceHandlers<TEntity>;
}

export type {
  AdminColumn,
  AdminColumnType,
  AdminResource,
  AdminResourceDefinition,
  AdminResourceHandlers,
};
