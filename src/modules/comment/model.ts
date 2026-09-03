import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { TaskModel } from "../task/model";
import CommentRepository from "./repository";
import type { CommentRecord } from "./types";

class CommentModelClass extends Model<CommentRecord, "id"> {
  static override $fillable = ["task_id", "tenant_id", "body"] as const;
  static override $casts = {
    created_at: "datetime",
    deleted_at: "datetime",
  } as const;

  protected override primaryKey(): "id" {
    return "id";
  }

  task() {
    return this.belongsTo(TaskModel);
  }
}

const commentRepository = new CommentRepository();

export const CommentModel = registerModelRepository(CommentModelClass, commentRepository);

export { commentRepository };
