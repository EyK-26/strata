interface FailedJobRecord {
  id: number;
  job_name: string;
  payload: Record<string, unknown>;
  exception: string;
  failed_at: Date;
}

export type { FailedJobRecord };
