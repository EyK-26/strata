interface FailedJobRecord {
  id: number;
  job_name: string;
  job_id?: string | null;
  payload: Record<string, unknown>;
  exception: string;
  failed_at: Date;
}

export type { FailedJobRecord };
