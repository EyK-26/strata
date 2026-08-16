import { describe, expect, test } from "bun:test";
import { NotFoundError } from "@getstrata/core/errors/http";
import {
  BaseRepository,
  belongsTo,
  type DatabaseConnection,
  defineTable,
  hasMany,
} from "../../src/core/database";
import CommentRepository from "../../src/modules/comment/repository";
import type { CommentRecord } from "../../src/modules/comment/types";
import OrganizationRepository from "../../src/modules/organization/repository";
import type { OrganizationRecord } from "../../src/modules/organization/types";
import ProjectRepository from "../../src/modules/project/repository";
import type { ProjectRecord } from "../../src/modules/project/types";
import TaskRepository from "../../src/modules/task/repository";
import type { TaskRecord } from "../../src/modules/task/types";

class FakeConnection implements DatabaseConnection {
  readonly calls: Array<{ query: string; params: readonly unknown[] }> = [];
  private readonly responses: unknown[][] = [];

  queue(rows: unknown[]): void {
    this.responses.push(rows);
  }

  async unsafe<T>(query: string, params: readonly unknown[] = []): Promise<T[]> {
    this.calls.push({ query, params: [...params] });
    return (this.responses.shift() ?? []) as T[];
  }
}

const now = new Date("2026-01-01T00:00:00.000Z");

const organization: OrganizationRecord = {
  id: 1,
  tenant_id: 10,
  name: "Acme",
  slug: "acme",
  created_at: now,
  updated_at: now,
  deleted_at: null,
};

const project: ProjectRecord = {
  id: 2,
  organization_id: 1,
  tenant_id: 10,
  name: "Platform",
  status: "active",
  created_at: now,
  updated_at: now,
  deleted_at: null,
};

const task: TaskRecord = {
  id: 3,
  project_id: 2,
  tenant_id: 10,
  title: "Write tests",
  status: "todo",
  priority: 1,
  created_at: now,
  updated_at: now,
  deleted_at: null,
};

const comment: CommentRecord = {
  id: 4,
  task_id: 3,
  tenant_id: 10,
  body: "Looks good.",
  created_at: now,
  deleted_at: null,
};

describe("module repositories", () => {
  test("OrganizationRepository finds records by slug", async () => {
    const connection = new FakeConnection();
    const repository = new OrganizationRepository().withConnection(connection);

    connection.queue([organization]);

    await expect(repository.findBySlug("acme")).resolves.toEqual(organization);
    expect(connection.calls[0]?.query).toContain('"organization"."slug" = $1');
  });

  test("CommentRepository finds comments by task id", async () => {
    const connection = new FakeConnection();
    const repository = new CommentRepository().withConnection(connection);

    connection.queue([comment]);

    await expect(repository.findByTaskId(3)).resolves.toEqual([comment]);
    expect(connection.calls[0]?.query).toContain('"comment"."task_id" = $1');
  });

  test("ProjectRepository attaches organizations and finds ids by organization", async () => {
    const connection = new FakeConnection();
    const organizationRepository = new OrganizationRepository().withConnection(connection);
    const repository = new ProjectRepository(organizationRepository).withConnection(connection);

    connection.queue([organization]);
    const withOrganizations = await repository.attachOrganizations([project]);
    expect(withOrganizations[0]?.organization).toEqual({
      id: 1,
      name: "Acme",
      slug: "acme",
    });

    connection.queue([project, { ...project, id: 6 }]);
    await expect(repository.findIdsByOrganizationIds(1)).resolves.toEqual([2, 6]);
  });

  test("ProjectRepository returns empty attachments for empty input", async () => {
    const repository = new ProjectRepository();

    await expect(repository.attachOrganizations([])).resolves.toEqual([]);
  });

  test("TaskRepository finds tasks by project and attaches projects", async () => {
    const connection = new FakeConnection();
    const projectRepository = new ProjectRepository().withConnection(connection);
    const repository = new TaskRepository(projectRepository).withConnection(connection);

    connection.queue([task]);
    connection.queue([project]);

    await expect(repository.findByProjectId(2)).resolves.toEqual([task]);

    const withProjects = await repository.attachProjects([task]);
    expect(withProjects[0]?.project).toEqual({
      id: 2,
      name: "Platform",
      organization_id: 1,
    });
  });

  test("TaskRepository returns empty attachments for empty input", async () => {
    const repository = new TaskRepository();

    await expect(repository.attachProjects([])).resolves.toEqual([]);
  });

  test("TaskRepository omits project when parent is missing", async () => {
    const connection = new FakeConnection();
    const projectRepository = new ProjectRepository().withConnection(connection);
    const repository = new TaskRepository(projectRepository).withConnection(connection);

    connection.queue([]);

    const withProjects = await repository.attachProjects([task]);
    expect(withProjects[0]).toEqual(task);
    expect(withProjects[0]?.project).toBeUndefined();
  });
});

describe("base repository helpers", () => {
  const metricTable = defineTable<{ id: number; score: number; group_code: string }, "id">({
    name: "metric",
    primaryKey: "id",
    columns: ["id", "score", "group_code"],
  });

  class MetricRepository extends BaseRepository<
    { id: number; score: number; group_code: string },
    "id"
  > {
    constructor(connection: DatabaseConnection) {
      super(metricTable, connection);
    }

    countScores(where = {}) {
      return this.countWhere(where);
    }

    averageScore(where = {}) {
      return this.averageColumn("score", where);
    }

    pluckScores(options = {}) {
      return this.pluckNumberValues('"score"', "score", options);
    }

    countByGroup(where = {}) {
      return this.countGroupedBy("group_code", where);
    }

    findByGroup(groupCode: string) {
      return this.findByHasManyRelation(
        hasMany<
          { id: string },
          { id: number; score: number; group_code: string },
          "id",
          "group_code"
        >({
          name: "metrics",
          localKey: "id",
          foreignKey: "group_code",
        }),
        groupCode as unknown as "id",
      );
    }

    loadBelongsToOwners(
      records: Array<{ id: number; owner_id: number }>,
      owners: BaseRepository<{ id: number; label: string }, "id">,
    ) {
      return this.loadBelongsToForParents(
        records,
        belongsTo<
          { id: number; owner_id: number },
          { id: number; label: string },
          "owner_id",
          "id"
        >({
          name: "owner",
          foreignKey: "owner_id",
          ownerKey: "id",
        }),
        owners,
      );
    }
  }

  test("findByIds returns empty array for empty input", async () => {
    const connection = new FakeConnection();
    const repository = new MetricRepository(connection);

    await expect(repository.findByIds([])).resolves.toEqual([]);
    expect(connection.calls).toHaveLength(0);
  });

  test("findByIdOrThrow uses default error when record is missing", async () => {
    const connection = new FakeConnection();
    const repository = new MetricRepository(connection);

    connection.queue([]);

    await expect(repository.findByIdOrThrow(404)).rejects.toThrow("metric 404 was not found.");
  });

  test("findByIdOrThrow uses custom error factory", async () => {
    const connection = new FakeConnection();
    const repository = new MetricRepository(connection);

    connection.queue([]);

    await expect(
      repository.findByIdOrThrow(404, (id) => new NotFoundError(`Missing ${id}`)),
    ).rejects.toThrow("Missing 404");
  });

  test("updateByIdOrThrow throws when no row is updated", async () => {
    const connection = new FakeConnection();
    const repository = new MetricRepository(connection);

    connection.queue([]);

    await expect(repository.updateByIdOrThrow(1, { score: 10 })).rejects.toThrow(
      "metric 1 was not found.",
    );
  });

  test("countWhere, averageColumn, pluckNumberValues, and countGroupedBy query helpers", async () => {
    const connection = new FakeConnection();
    const repository = new MetricRepository(connection);

    connection.queue([{ count: "3" }]);
    await expect(repository.countScores({ group_code: "A" })).resolves.toBe(3);

    connection.queue([{ value: "12.6" }]);
    await expect(repository.averageScore()).resolves.toBe(13);

    connection.queue([{ score: 1 }, { score: null }, { score: 3 }]);
    await expect(repository.pluckScores()).resolves.toEqual([1, 3]);

    connection.queue([
      { value: "A", count: "2" },
      { value: "B", count: "1" },
    ]);
    await expect(repository.countByGroup()).resolves.toEqual([
      { value: "A", count: 2 },
      { value: "B", count: 1 },
    ]);
  });

  test("findByHasManyRelation and loadBelongsToForParents helpers", async () => {
    const connection = new FakeConnection();
    const repository = new MetricRepository(connection);
    const ownerTable = defineTable<{ id: number; label: string }, "id">({
      name: "owner",
      primaryKey: "id",
      columns: ["id", "label"],
    });
    class OwnerRepository extends BaseRepository<{ id: number; label: string }, "id"> {
      constructor(conn: DatabaseConnection) {
        super(ownerTable, conn);
      }
    }
    const owners = new OwnerRepository(connection);

    connection.queue([{ id: 1, score: 5, group_code: "A" }]);
    await expect(repository.findByGroup("A" as unknown as "id")).resolves.toHaveLength(1);

    connection.queue([{ id: 9, label: "Owner" }]);
    const ownersById = await repository.loadBelongsToOwners([{ id: 1, owner_id: 9 }], owners);
    expect(ownersById.get(9)).toEqual({ id: 9, label: "Owner" });
    await expect(repository.loadBelongsToOwners([], owners)).resolves.toEqual(new Map());
  });
});
