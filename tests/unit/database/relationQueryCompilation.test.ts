import { describe, expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineRepository, type RepositoryBinding } from "@getstrata/core/database/definitions";
import { belongsToMany, hasManyThrough } from "@getstrata/core/database/relationships";
import { defineTable } from "@getstrata/core/database/table";
import type { QueryOptions, QueryWhere } from "@getstrata/core/database/types";
import type { DatabaseConnection } from "../../../src/core/database/connectionContracts";
import { withRepositories } from "../../helpers/boundRepositoryHarness";

type Parent = { id: number };
type Far = {
  id: number;
  bridge_id: number;
  tenant_id: number;
  name: string;
  deleted_at: Date | null;
};
type Pivot = { parent_id: number; far_id: number };

const table = defineTable<Far, "id">({
  name: "far_rows",
  primaryKey: "id",
  columns: ["id", "bridge_id", "tenant_id", "name", "deleted_at"],
  softDeletes: true,
});
const through = hasManyThrough<Parent, Far, "id", "parent_id", "id", "bridge_id">({
  name: "far",
  localKey: "id",
  throughTable: "bridges",
  firstKey: "parent_id",
  secondLocalKey: "id",
  secondKey: "bridge_id",
  throughParentKey: "source_parent",
});
const pivot = belongsToMany<Parent, Far, Pivot, "id", "id", "parent_id", "far_id">({
  name: "far",
  pivotTable: "parent_far",
  parentKey: "id",
  relatedKey: "id",
  foreignPivotKey: "parent_id",
  relatedPivotKey: "far_id",
});

class RecordingConnection implements DatabaseConnection {
  readonly calls: Array<{ text: string; params: readonly unknown[] }> = [];
  readonly responses: unknown[][] = [];

  async unsafe<T>(text: string, params: readonly unknown[] = []): Promise<T[]> {
    this.calls.push({ text, params: [...params] });
    return (this.responses.shift() ?? []) as T[];
  }
}

class ScopedRepository extends BaseRepository<Far, "id"> {
  readonly #tenantId: number;

  constructor(
    binding: RepositoryBinding<Far, "id">,
    readonly scopes: QueryWhere<Far>[] = [],
    tenantId = 7,
  ) {
    super(binding);
    this.#tenantId = tenantId;
  }

  applyScope(options: QueryOptions<Far>): QueryOptions<Far> {
    const { where = {}, ...rest } = options;
    this.scopes.push(where);
    return { ...rest, where: { ...where, tenant_id: this.#tenantId } };
  }
}
const plainDefinition = defineRepository({
  name: "Plain",
  table,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const scopedDefinition = defineRepository({
  name: "Scoped",
  table,
  dependencies: [],
  create: (binding) => new ScopedRepository(binding),
  hooks: { transformQuery: scopedPlan },
});
function scopedPlan(
  plan: QueryOptions<Far>,
  binding: RepositoryBinding<Far, "id">,
): QueryOptions<Far> {
  return binding.session.repository(scopedDefinition).applyScope(plan);
}

for (const driver of ["pgsql", "mysql", "sqlite"] as const) {
  describe(`relation SQL compilation with ${driver}`, () => {
    test("through reads preserve parent deduplication, scoped joins, parameter order and aliases", async () => {
      const connection = new RecordingConnection();
      await withRepositories(
        connection,
        [plainDefinition, scopedDefinition] as const,
        async ([repository, _related], _database) => {
          const child: Far = {
            id: 20,
            bridge_id: 30,
            tenant_id: 7,
            name: "visible",
            deleted_at: null,
          };
          connection.responses.push([{ ...child, source_parent: 2 }]);

          const grouped = await repository.loadHasManyThroughForParents(
            [{ id: 2 }, { id: 2 }, { id: 5 }],
            through,
            {
              where: { tenant_id: 7 },
              whereNodes: [{ kind: "and", where: { name: "visible" } }],
              joins: [
                {
                  type: "left",
                  table: "labels",
                  on: [
                    {
                      left: { table: "far_rows", column: "id" },
                      right: { table: "labels", column: "far_id" },
                    },
                  ],
                },
              ],
            },
          );

          expect(grouped.get(2)).toEqual([child]);
          expect(grouped.get(5)).toEqual([]);
          expect(connection.calls).toHaveLength(1);
          const call = connection.calls[0];
          expect(call?.params).toEqual([2, 5, 7, "visible"]);
          const quote = driver === "mysql" ? "`" : '"';
          const column = (owner: string, name: string) =>
            `${quote}${owner}${quote}.${quote}${name}${quote}`;
          expect(call?.text).toContain(`${column("bridges", "parent_id")} AS source_parent`);
          expect(call?.text).toContain(`INNER JOIN ${quote}bridges${quote}`);
          expect(call?.text).toContain(`LEFT JOIN ${quote}labels${quote}`);
          expect(call?.text).toContain(`${column("far_rows", "deleted_at")} IS NULL`);
          expect(call?.text).toContain(`IN (${driver === "pgsql" ? "$1, $2" : "?, ?"})`);
          expect(call?.text).toContain(
            `${column("far_rows", "tenant_id")} = ${driver === "pgsql" ? "$3" : "?"}`,
          );
          expect(call?.text).toContain(
            `${column("far_rows", "name")} = ${driver === "pgsql" ? "$4" : "?"}`,
          );
        },
        driver,
      );
    });

    test("empty through input and a duplicate through join never execute SQL", async () => {
      const connection = new RecordingConnection();
      await withRepositories(
        connection,
        [plainDefinition, scopedDefinition] as const,
        async ([repository, _related], _database) => {
          expect(await repository.loadHasManyThroughForParents([], through)).toEqual(new Map());
          await expect(
            repository.loadHasManyThroughForParents([{ id: 2 }], through, {
              joins: [{ type: "inner", table: "bridges", on: [] }],
            }),
          ).rejects.toThrow("joins the through table twice");
          expect(connection.calls).toHaveLength(0);
        },
        driver,
      );
    });

    test("pivot reads preserve typed related query hooks and bound private state", async () => {
      const connection = new RecordingConnection();
      await withRepositories(
        connection,
        [plainDefinition, scopedDefinition] as const,
        async ([repository, related], database) => {
          const child: Far = {
            id: 20,
            bridge_id: 30,
            tenant_id: 7,
            name: "visible",
            deleted_at: null,
          };
          connection.responses.push(
            [
              { parent_id: 2, far_id: 20 },
              { parent_id: 5, far_id: 20 },
            ],
            [child],
          );

          const grouped = await repository.loadBelongsToManyForParents(
            [{ id: 2 }, { id: 5 }, { id: 2 }],
            pivot,
            related,
          );
          expect(grouped.get(2)).toEqual([child]);
          expect(grouped.get(5)).toEqual([child]);
          expect(connection.calls[0]).toEqual({
            text: `SELECT * FROM parent_far WHERE parent_id IN (${driver === "pgsql" ? "$1, $2" : "?, ?"})`,
            params: [2, 5],
          });
          expect(connection.calls[1]?.params).toEqual([20, 7]);
          expect(related.scopes).toEqual([{ id: [20] }]);
          expect(database.repository(scopedDefinition)).toBe(related);

          const count = connection.calls.length;
          expect(await repository.loadBelongsToManyForParents([], pivot, related)).toEqual(
            new Map(),
          );
          expect(connection.calls).toHaveLength(count);
          connection.responses.push([]);
          const empty = await repository.loadBelongsToManyForParents([{ id: 2 }], pivot, related);
          expect(empty.get(2)).toEqual([]);
          expect(connection.calls).toHaveLength(count + 1);
          expect(related.scopes).toHaveLength(1);
        },
        driver,
      );
    });
  });
}
