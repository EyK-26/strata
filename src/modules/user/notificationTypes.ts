interface NotificationRecord {
  id: number;
  user_id: number;
  tenant_id: number;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: Date | null;
  created_at: Date;
}

export type { NotificationRecord };
