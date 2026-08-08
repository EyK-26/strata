import { BaseRepository } from "../../core/database";
import { commentTable } from "./table";
import type { CommentRecord } from "./types";

class CommentRepository extends BaseRepository<CommentRecord, "id"> {
  constructor() {
    super(commentTable);
  }

  async findByTaskId(taskId: number): Promise<CommentRecord[]> {
    return await this.findWhere({ task_id: taskId });
  }
}

export default CommentRepository;
