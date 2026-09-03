import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { ProjectModel } from "../project/model";
import TaskRepository from "./repository";
import type { TaskRecord } from "./types";

class TaskModelClass extends Model<TaskRecord, "id"> {
  static override $fillable = ["project_id", "tenant_id", "title", "status", "priority"] as const;
  static override $casts = {
    created_at: "datetime",
    updated_at: "datetime",
    deleted_at: "datetime",
  } as const;

  protected override primaryKey(): "id" {
    return "id";
  }

  project() {
    return this.belongsTo(ProjectModel);
  }

  comments() {
    const { CommentModel } = require("../comment/model.ts") as typeof import("../comment/model.ts");
    return this.hasMany(CommentModel);
  }
}

const taskRepository = new TaskRepository();

export const TaskModel = registerModelRepository(TaskModelClass, taskRepository);

export { taskRepository };
