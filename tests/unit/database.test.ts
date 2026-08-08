import { describe, expect, test } from "bun:test";
import {
  buildSelectQuery,
  buildWhereClause,
  defineTable,
  hasMany,
  indexHasManyRelation,
} from "../../src/core/database";

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

    const tasksByProjectId = indexHasManyRelation(
      projects,
      tasks,
      projectHasManyTasks,
    );

    expect(tasksByProjectId.get(1)).toEqual(tasks);
    expect(tasksByProjectId.get(2)).toEqual([]);
  });
});
