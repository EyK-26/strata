import { describe, expect, test } from "bun:test";
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";
import { CommentFactory } from "../../src/modules/comment/factory";
import { CommentModel } from "../../src/modules/comment/model";
import { toCommentResource } from "../../src/modules/comment/resources";
import { OrganizationFactory } from "../../src/modules/organization/factory";
import { OrganizationModel } from "../../src/modules/organization/model";
import { toOrganizationResource } from "../../src/modules/organization/resources";
import { ProjectFactory } from "../../src/modules/project/factory";
import { ProjectModel } from "../../src/modules/project/model";
import { toProjectResource } from "../../src/modules/project/resources";
import { TaskFactory } from "../../src/modules/task/factory";
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

    await runWithTenantDatabase(defaultTestTenant, async () => {
      const organization = await new OrganizationFactory().create({ name: "Eloquent Org" });
      expect(organization.id).toBeGreaterThan(0);

      const project = await new ProjectFactory().for(organization, "organization_id").create({
        tenant_id: organization.tenant_id,
        name: "Eloquent Project",
      });
      expect(project.organization_id).toBe(organization.id);

      const created = await new OrganizationFactory()
        .has(new ProjectFactory().state({ name: "Child Project" }), "organization_id")
        .create({ name: "Parent Org" });
      expect(created.id).toBeGreaterThan(0);

      const task = await new TaskFactory().for(project, "project_id").create({
        tenant_id: project.tenant_id,
        title: "Eloquent Task",
      });
      const comment = await new CommentFactory().for(task, "task_id").create({
        tenant_id: task.tenant_id,
        body: "Eloquent comment",
      });
      expect(comment.task_id).toBe(task.id);

      const orgModel = new OrganizationModel(organization, OrganizationModel.repository());
      const projects = await orgModel.projects().where({ name: "Eloquent Project" }).get();
      expect(projects).toHaveLength(1);
      expect(projects[0]?.get("name")).toBe("Eloquent Project");

      const loadedProject = ProjectModel.newFromRecord(project);
      await loadedProject.load("organization");
      expect(
        loadedProject.loaded<{ get: (key: "name") => string }>("organization")?.get("name"),
      ).toBe("Eloquent Org");
    });
  });
});
