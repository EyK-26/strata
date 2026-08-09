import { describe, expect, test } from "bun:test";
import {
  buildCountQuery,
  buildDeleteByIdQuery,
  buildGroupedCountQuery,
  buildInsertQuery,
  buildProjectionQuery,
  buildRestoreByIdQuery,
  buildSelectQuery,
  buildSoftDeleteByIdQuery,
  buildUpdateQuery,
  buildWhereClause,
  quoteIdentifier,
} from "@getstrata/core/database/query";
import { hasMany, indexHasManyRelation } from "@getstrata/core/database/relationships";
import { defineTable } from "@getstrata/core/database/table";

type Project = {
  id: number;
  organization_id: number;
  name: string;
  status: string;
};

type Task = {
  id: number;
  project_id: number;
  title: string;
  status: string;
  priority: number;
};

const projectHasManyTasks = hasMany<Project, Task, "id", "project_id">({
  name: "tasks",
  localKey: "id",
  foreignKey: "project_id",
});

describe("database query helpers", () => {
  test("rejects invalid SQL identifiers", () => {
    expect(() => quoteIdentifier("bad-name")).toThrow("Invalid SQL identifier");
  });

  test("builds where clauses with equality, ranges, and IN filters", () => {
    const { clause, params } = buildWhereClause<Task>("task", {
      status: "todo",
      priority: { gte: 1, lte: 5 },
      project_id: [1, 2],
    });

    expect(clause).toBe(
      ' WHERE "task"."status" = $1 AND "task"."priority" >= $2 AND "task"."priority" <= $3 AND "task"."project_id" IN ($4, $5)',
    );
    expect(params).toEqual(["todo", 1, 5, 1, 2]);
  });

  test("builds where clauses with null checks and operator filters", () => {
    const { clause, params } = buildWhereClause<Task>("task", {
      status: null,
      priority: { gt: 0, lt: 10, gte: 1, lte: 5, in: [1, 2] },
    });

    expect(clause).toContain('"task"."status" IS NULL');
    expect(clause).toContain('"task"."priority" IN ($1, $2)');
    expect(clause).toContain('"task"."priority" > $3');
    expect(clause).toContain('"task"."priority" <= $6');
    expect(params).toEqual([1, 2, 0, 1, 10, 5]);
  });

  test("buildInClause returns false guard for empty arrays", () => {
    const { clause } = buildWhereClause<Task>("task", {
      project_id: { in: [] },
    });

    expect(clause).toContain("1 = 0");
  });

  test("builds operator clauses for equality and nullability", () => {
    const { clause: nullClause } = buildWhereClause<Task>("task", {
      priority: { isNull: true },
    });
    const { clause: notNullClause } = buildWhereClause<Task>("task", {
      priority: { isNull: false },
    });
    const { clause: eqNullClause } = buildWhereClause<Task>("task", {
      priority: { eq: null },
    });
    const { clause: eqValueClause, params: eqValueParams } = buildWhereClause<Task>("task", {
      priority: { eq: 3 },
    });

    expect(nullClause).toContain("IS NULL");
    expect(notNullClause).toContain("IS NOT NULL");
    expect(eqNullClause).toContain("IS NULL");
    expect(eqValueClause).toContain('"task"."priority" = $1');
    expect(eqValueParams).toEqual([3]);
  });

  test("throws when query limits are invalid", () => {
    const userTable = defineTable<{ id: number; name: string }, "id">({
      name: "user_account",
      primaryKey: "id",
      columns: ["id", "name"],
    });

    expect(() => buildSelectQuery(userTable, { limit: 0 })).toThrow(
      "Query limit must be a positive integer.",
    );
    expect(() => buildSelectQuery(userTable, { offset: -1 })).toThrow(
      "Query offset must be a non-negative integer.",
    );
  });

  test("builds insert, update, delete, count, projection, and grouped count queries", () => {
    const userTable = defineTable<{ id: number; name: string; deleted_at: Date | null }, "id">({
      name: "user_account",
      primaryKey: "id",
      columns: ["id", "name", "deleted_at"],
      softDeletes: { column: "deleted_at" },
    });

    expect(buildInsertQuery(userTable, { id: 1, name: "Ada" }).text).toContain("INSERT INTO");
    expect(
      buildInsertQuery(userTable, { id: 1, name: undefined as unknown as string }).text,
    ).toContain("INSERT INTO");
    expect(() => buildInsertQuery(userTable, {})).toThrow("Cannot insert into user_account");
    expect(buildUpdateQuery(userTable, 1, { name: "Grace" }).text).toContain("UPDATE");
    expect(() => buildUpdateQuery(userTable, 1, {})).toThrow("Cannot update user_account");
    expect(buildDeleteByIdQuery(userTable, 1).text).toContain("DELETE FROM");
    expect(buildCountQuery(userTable, { name: "Ada" }, { onlyTrashed: true }).text).toContain(
      "COUNT(*)",
    );
    expect(
      buildProjectionQuery(userTable, "COUNT(*)", "total", { where: { name: "Ada" } }).text,
    ).toContain('AS "total"');
    expect(() => buildProjectionQuery(userTable, "AVG(name); DROP TABLE users;", "total")).toThrow(
      "Unsafe projection expression",
    );
    expect(buildGroupedCountQuery(userTable, "name").text).toContain("GROUP BY");
    expect(
      buildSoftDeleteByIdQuery(userTable, 1, new Date("2026-01-01T00:00:00.000Z")).text,
    ).toContain('"deleted_at" = $1');
    expect(buildRestoreByIdQuery(userTable, 1).text).toContain("IS NOT NULL");
    expect(() =>
      buildRestoreByIdQuery(
        defineTable<{ id: number; name: string }, "id">({
          name: "plain",
          primaryKey: "id",
          columns: ["id", "name"],
        }),
        1,
      ),
    ).toThrow("does not support soft deletes");
    expect(() =>
      buildSoftDeleteByIdQuery(
        defineTable<{ id: number; name: string }, "id">({
          name: "plain",
          primaryKey: "id",
          columns: ["id", "name"],
        }),
        1,
        new Date(),
      ),
    ).toThrow("does not support soft deletes");
  });

  test("builds select queries with table metadata defaults", () => {
    const userTable = defineTable<{ id: number; name: string }, "id">({
      name: "user_account",
      primaryKey: "id",
      columns: ["id", "name"],
      defaultOrderBy: { column: "id", direction: "DESC" },
    });

    const { text, params } = buildSelectQuery(userTable, {
      where: { id: { gte: 10 } },
      limit: 5,
    });

    expect(text).toBe(
      'SELECT "user_account"."id", "user_account"."name" FROM "user_account" WHERE "user_account"."id" >= $1 ORDER BY "user_account"."id" DESC LIMIT 5',
    );
    expect(params).toEqual([10]);
  });

  test("uses default deleted_at column when softDeletes is true", () => {
    const userTable = defineTable<{ id: number; name: string; deleted_at: Date | null }, "id">({
      name: "user_account",
      primaryKey: "id",
      columns: ["id", "name", "deleted_at"],
      softDeletes: true,
    });

    const { text } = buildSelectQuery(userTable, {});
    expect(text).toContain('"user_account"."deleted_at" IS NULL');
  });

  test("builds select queries with offset for pagination", () => {
    const userTable = defineTable<{ id: number; name: string }, "id">({
      name: "user_account",
      primaryKey: "id",
      columns: ["id", "name"],
    });

    const { text } = buildSelectQuery(userTable, {
      limit: 15,
      offset: 30,
    });

    expect(text).toContain("LIMIT 15 OFFSET 30");
  });
});

describe("database relationship helpers", () => {
  test("indexes hasMany relations while preserving empty parent groups", () => {
    const projects: Project[] = [
      {
        id: 1,
        organization_id: 10,
        name: "Platform Rewrite",
        status: "active",
      },
      {
        id: 2,
        organization_id: 10,
        name: "Legacy Migration",
        status: "draft",
      },
    ];

    const tasks: Task[] = [
      {
        id: 1,
        project_id: 1,
        title: "Design module registry",
        status: "done",
        priority: 3,
      },
      {
        id: 2,
        project_id: 1,
        title: "Implement query layer",
        status: "in_progress",
        priority: 4,
      },
    ];

    const tasksByProjectId = indexHasManyRelation(projects, tasks, projectHasManyTasks);

    expect(tasksByProjectId.get(1)).toEqual(tasks);
    expect(tasksByProjectId.get(2)).toEqual([]);
  });

  test("builds order by clauses from explicit and shorthand syntax", () => {
    const table = defineTable<Task, "id">({
      name: "tasks",
      primaryKey: "id",
      columns: ["id", "project_id", "title", "status", "priority"],
    });

    const explicit = buildSelectQuery(table, {
      orderBy: { column: "priority", direction: "desc" },
    });
    expect(explicit.text).toContain('"tasks"."priority" DESC');

    const shorthand = buildSelectQuery(table, {
      orderBy: { priority: "desc", title: "asc" },
    });
    expect(shorthand.text).toContain('"tasks"."priority" DESC');
    expect(shorthand.text).toContain('"tasks"."title" ASC');

    const arrayForm = buildSelectQuery(table, {
      orderBy: [
        { column: "priority", direction: "desc" },
        { column: "title", direction: "asc" },
      ],
    });
    expect(arrayForm.text).toContain('"tasks"."priority" DESC');
    expect(arrayForm.text).toContain('"tasks"."title" ASC');
  });
});
