import { Factory } from "@getstrata/core/database/factory";
import CommentRepository from "./repository";
import type { CommentRecord } from "./types";

class CommentFactory extends Factory<CommentRecord> {
  protected override definition(): CommentRecord {
    return {
      id: 0,
      task_id: 1,
      tenant_id: 1,
      body: "Factory comment",
      created_at: new Date(),
      deleted_at: null,
    };
  }

  protected override persist(values: Partial<CommentRecord>): Promise<CommentRecord> {
    return new CommentRepository().create(values);
  }
}

const commentFactory = new CommentFactory();

export { CommentFactory, commentFactory };
