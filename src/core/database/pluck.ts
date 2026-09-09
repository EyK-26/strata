import type { QuerySelectItem } from "./types.ts";

function uniqueColumnSelect(table: string, columns: readonly string[]): QuerySelectItem[] {
  const seen = new Set<string>();
  const select: QuerySelectItem[] = [];

  for (const column of columns) {
    if (seen.has(column)) {
      continue;
    }

    seen.add(column);
    select.push({ kind: "column", table, column, as: column });
  }

  return select;
}

function projectPluck<T extends object, K extends keyof T & string>(
  rows: readonly T[],
  column: K,
): Array<T[K]>;
function projectPluck<T extends object, K extends keyof T & string, KK extends keyof T & string>(
  rows: readonly T[],
  column: K,
  keyBy: KK,
): Map<T[KK], T[K]>;
function projectPluck<T extends object, K extends keyof T & string, KK extends keyof T & string>(
  rows: readonly T[],
  column: K,
  keyBy?: KK,
): Array<T[K]> | Map<T[KK], T[K]> {
  if (keyBy === undefined) {
    return rows.map((row) => row[column]);
  }

  const keyed = new Map<T[KK], T[K]>();

  for (const row of rows) {
    keyed.set(row[keyBy], row[column]);
  }

  return keyed;
}

export { projectPluck, uniqueColumnSelect };
