interface AttachmentRecord {
  id: number;
  task_id: number;
  tenant_id: number;
  user_id: number;
  original_name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  created_at: Date;
  deleted_at: Date | null;
}

export type { AttachmentRecord };
