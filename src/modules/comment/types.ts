interface CommentRecord {
  id: number;
  task_id: number;
  tenant_id: number;
  body: string;
  created_at: Date;
  deleted_at: Date | null;
}

export type { CommentRecord };
