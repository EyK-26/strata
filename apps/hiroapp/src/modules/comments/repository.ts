import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { type CommentRecord, commentTable } from "./table.ts";

class CommentRepository extends BaseRepository<CommentRecord, "id"> {
  constructor() {
    super(commentTable);
  }
}

export const comments = new CommentRepository();
export type { CommentRecord };
