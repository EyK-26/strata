import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { OrganizationModel } from "../organization/model";
import ProjectRepository from "./repository";
import type { ProjectRecord } from "./types";

class ProjectModelClass extends Model<ProjectRecord, "id"> {
  static override $fillable = ["organization_id", "tenant_id", "name", "status"] as const;
  static override $casts = {
    created_at: "datetime",
    updated_at: "datetime",
    deleted_at: "datetime",
  } as const;

  protected override primaryKey(): "id" {
    return "id";
  }

  organization() {
    return this.belongsTo(OrganizationModel);
  }

  tasks() {
    const { TaskModel } = require("../task/model.ts") as typeof import("../task/model.ts");
    return this.hasMany(TaskModel);
  }
}

const projectRepository = new ProjectRepository();

export const ProjectModel = registerModelRepository(ProjectModelClass, projectRepository);

export { projectRepository };
