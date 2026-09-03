import { describe, expect, test } from "bun:test";
import { Factory } from "@getstrata/core/database/factory";
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";
import { CommentModel } from "../../src/modules/comment/model";
import { toCommentResource } from "../../src/modules/comment/resources";
import { OrganizationModel } from "../../src/modules/organization/model";
import { toOrganizationResource } from "../../src/modules/organization/resources";
import { ProjectModel } from "../../src/modules/project/model";
import { toProjectResource } from "../../src/modules/project/resources";
import { TaskModel } from "../../src/modules/task/model";
import { toTaskResource } from "../../src/modules/task/resources";
import { userFactory } from "../../src/modules/user/factory";
import { UserModel } from "../../src/modules/user/model";
import { toUserResource } from "../../src/modules/user/resources";
import { defaultTestTenant } from "./testHelpers";

describe("WorkHub Eloquent models", () => {
  test("relation methods use inferred keys on the organization graph", () => {
    const organization = new OrganizationModel(
      {
        id: 1,
        tenant_id: 1,
        name: "Acme",
        slug: "acme",
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      },
      OrganizationModel.repository(),
    );
    const project = new ProjectModel(
      {
        id: 2,
        organization_id: 1,
        tenant_id: 1,
        name: "Platform",
        status: "active",
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      },
      ProjectModel.repository(),
    );
    const task = new TaskModel(
      {
        id: 3,
        project_id: 2,
        tenant_id: 1,
        title: "Query layer",
        status: "todo",
        priority: 1,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      },
      TaskModel.repository(),
    );
    const comment = new CommentModel(
      {
        id: 4,
        task_id: 3,
        tenant_id: 1,
        body: "Looks good",
        created_at: new Date(),
        deleted_at: null,
      },
      CommentModel.repository(),
    );
    const user = new UserModel(
      {
        id: 5,
        name: "Ada",
        email: "ada@workhub.test",
        role: "member",
        tenant_id: 1,
        current_organization_id: 1,
        created_at: new Date(),
        updated_at: new Date(),
      },
      UserModel.repository(),
    );

    expect(organization.projects().kind).toBe("hasMany");
    expect(organization.projects().relation).toMatchObject({ foreignKey: "organization_id" });
    expect(project.organization().kind).toBe("belongsTo");
    expect(project.tasks().kind).toBe("hasMany");
    expect(task.project().kind).toBe("belongsTo");
    expect(task.comments().kind).toBe("hasMany");
    expect(comment.task().kind).toBe("belongsTo");
    expect(user.currentOrganization().kind).toBe("belongsTo");
    expect(user.currentOrganization().relation).toMatchObject({
      foreignKey: "current_organization_id",
    });
  });

  test("JsonResource wrappers keep the existing collection shape", () => {
    const now = new Date("2026-09-03T10:00:00.000Z");

    expect(
      toOrganizationResource({
        id: 1,
        tenant_id: 1,
        name: "Acme",
        slug: "acme",
        created_at: now,
        updated_at: now,
        deleted_at: null,
      }),
    ).toEqual({
      id: 1,
      name: "Acme",
      slug: "acme",
      created_at: "2026-09-03T10:00:00.000Z",
      updated_at: "2026-09-03T10:00:00.000Z",
    });

    expect(
      toProjectResource({
        id: 2,
        organization_id: 1,
        tenant_id: 1,
        name: "Platform",
        status: "active",
        created_at: now,
        updated_at: now,
        deleted_at: null,
        organization: { id: 1, name: "Acme", slug: "acme" },
      }),
    ).toMatchObject({
      id: 2,
      organization_id: 1,
      organization: { id: 1, name: "Acme", slug: "acme" },
    });

    expect(
      toTaskResource({
        id: 3,
        project_id: 2,
        tenant_id: 1,
        title: "Query layer",
        status: "todo",
        priority: 1,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      }),
    ).toMatchObject({ id: 3, project_id: 2, title: "Query layer" });

    expect(
      toCommentResource({
        id: 4,
        task_id: 3,
        tenant_id: 1,
        body: "Looks good",
        created_at: now,
        deleted_at: null,
      }),
    ).toEqual({
      id: 4,
      task_id: 3,
      body: "Looks good",
      created_at: "2026-09-03T10:00:00.000Z",
    });

    expect(
      toUserResource({
        id: 5,
        name: "Ada",
        email: "ada@workhub.test",
        role: "member",
        tenant_id: 1,
        created_at: now,
        updated_at: now,
      }),
    ).toEqual({
      id: 5,
      name: "Ada",
      email: "ada@workhub.test",
      role: "member",
    });
  });

  test("factories compose with state, for, and has", async () => {
    expect(userFactory.admin().make().role).toBe("admin");
    expect(userFactory.make().role).toBe("member");

    const inserted: Array<Record<string, unknown>> = [];

    class MemoryProjectFactory extends Factory<{
      id?: number;
      organization_id?: number;
      name: string;
    }> {
      protected override definition() {
        return { id: 0, name: "Child Project" };
      }

      protected override async persist(
        values: Partial<{ id?: number; organization_id?: number; name: string }>,
      ) {
        inserted.push(values);
        return {
          id: inserted.length,
          name: values.name ?? "Child Project",
          organization_id: values.organization_id,
        };
      }
    }

    class MemoryOrgFactory extends Factory<{ id?: number; name: string }> {
      protected override definition() {
        return { id: 0, name: "Parent Org" };
      }

      protected override async persist(values: Partial<{ id?: number; name: string }>) {
        return { id: 40, name: values.name ?? "Parent Org" };
      }
    }

    const child = await new MemoryProjectFactory().for({ id: 7 }, "organization_id").create();
    expect(child).toEqual({ id: 1, name: "Child Project", organization_id: 7 });

    inserted.length = 0;
    await new MemoryOrgFactory().has(new MemoryProjectFactory(), "organization_id").create();
    expect(inserted).toEqual([{ name: "Child Project", organization_id: 40 }]);
  });

  test("OrganizationModel.projects and ProjectModel.load use seeded rows", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const org = new OrganizationModel(
        {
          id: 1,
          tenant_id: 1,
          name: "Acme Labs",
          slug: "acme-labs",
          created_at: new Date(),
          updated_at: new Date(),
          deleted_at: null,
        },
        OrganizationModel.repository(),
      );
      const projects = await org.projects().get();
      expect(projects.length).toBeGreaterThan(0);
      expect(projects.some((project) => project.get("organization_id") === 1)).toBe(true);

      const first = projects[0];
      if (!first) {
        throw new Error("expected a seeded project");
      }

      const loaded = new ProjectModel(
        {
          id: Number(first.get("id")),
          organization_id: 1,
          tenant_id: 1,
          name: String(first.get("name")),
          status: "active",
          created_at: new Date(),
          updated_at: new Date(),
          deleted_at: null,
        },
        ProjectModel.repository(),
      );
      await loaded.load("organization");
      expect(loaded.loaded<{ get: (key: "name") => string }>("organization")?.get("name")).toBe(
        "Acme Labs",
      );
    });
  });
});
