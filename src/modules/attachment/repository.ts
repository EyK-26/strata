import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { attachmentTable } from "./table";
import type { AttachmentRecord } from "./types";

class AttachmentRepository extends BaseRepository<AttachmentRecord, "id"> {
  constructor() {
    super(attachmentTable);
  }

  async findByTaskId(taskId: number): Promise<AttachmentRecord[]> {
    return await this.findWhere({ task_id: taskId });
  }
}

export default AttachmentRepository;
