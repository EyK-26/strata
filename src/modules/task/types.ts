import type { TaskStatus } from "../../domain/workhub";

interface TaskRecord {
  id: number;
  project_id: number;
  tenant_id: number;
  title: string;
  status: TaskStatus;
  priority: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

interface TaskWithProjectRecord extends TaskRecord {
  project?: {
    id: number;
    name: string;
    organization_id: number;
  };
}

export type { TaskRecord, TaskWithProjectRecord };
