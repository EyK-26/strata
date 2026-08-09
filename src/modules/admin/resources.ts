import { AdminResourceRegistry } from "@getstrata/core";
import OrganizationRepository from "../organization/repository";
import ProjectRepository from "../project/repository";
import TaskRepository from "../task/repository";
import UserRepository from "../user/repository";

function createWorkHubAdminResources(): AdminResourceRegistry {
  const users = new UserRepository();
  const organizations = new OrganizationRepository();
  const projects = new ProjectRepository(organizations);
  const tasks = new TaskRepository();

  const registry = new AdminResourceRegistry();

  registry.register({
    name: "users",
    label: "User",
    labelPlural: "Users",
    columns: [
      { key: "id", label: "ID", type: "number" },
      { key: "email", label: "Email" },
      { key: "role", label: "Role" },
      { key: "created_at", label: "Created", type: "datetime" },
    ],
    handlers: {
      paginate: (options) => users.paginate({ ...options, orderBy: { id: "desc" } }),
      findById: (id) => users.findById(id),
    },
  });

  registry.register({
    name: "organizations",
    label: "Organization",
    labelPlural: "Organizations",
    columns: [
      { key: "id", label: "ID", type: "number" },
      { key: "name", label: "Name" },
      { key: "slug", label: "Slug" },
      { key: "tenant_id", label: "Tenant", type: "number" },
    ],
    handlers: {
      paginate: (options) => organizations.paginate({ ...options, orderBy: { id: "desc" } }),
      findById: (id) => organizations.findById(id),
    },
  });

  registry.register({
    name: "projects",
    label: "Project",
    labelPlural: "Projects",
    columns: [
      { key: "id", label: "ID", type: "number" },
      { key: "name", label: "Name" },
      { key: "status", label: "Status" },
      { key: "organization_id", label: "Organization", type: "number" },
    ],
    handlers: {
      paginate: (options) => projects.paginate({ ...options, orderBy: { id: "desc" } }),
      findById: (id) => projects.findById(id),
    },
  });

  registry.register({
    name: "tasks",
    label: "Task",
    labelPlural: "Tasks",
    columns: [
      { key: "id", label: "ID", type: "number" },
      { key: "title", label: "Title" },
      { key: "status", label: "Status" },
      { key: "project_id", label: "Project", type: "number" },
    ],
    handlers: {
      paginate: (options) => tasks.paginate({ ...options, orderBy: { id: "desc" } }),
      findById: (id) => tasks.findById(id),
    },
  });

  return registry;
}

export { createWorkHubAdminResources };
