import { parsePositiveIntParam } from "@getstrata/core/http";

type AttachmentIdParams = { id: string };
type TaskAttachmentParams = { id: string };

function parseAttachmentIdParams(params: AttachmentIdParams) {
  return {
    attachmentId: parsePositiveIntParam(params.id, "id"),
  };
}

function parseTaskAttachmentParams(params: TaskAttachmentParams) {
  return {
    taskId: parsePositiveIntParam(params.id, "id"),
  };
}

export type { AttachmentIdParams, TaskAttachmentParams };
export { parseAttachmentIdParams, parseTaskAttachmentParams };
