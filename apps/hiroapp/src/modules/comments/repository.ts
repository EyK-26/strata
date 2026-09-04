import { TenantRepository } from "../../lib/tenantRepository.ts";
import { type CommentRecord, commentTable } from "./table.ts";

class CommentRepository extends TenantRepository<CommentRecord, "id"> {
  constructor() {
    super(commentTable);
  }
}

export const comments = new CommentRepository();
export type { CommentRecord };
