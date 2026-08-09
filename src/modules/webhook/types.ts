interface WebhookRecord {
  id: number;
  organization_id: number | null;
  tenant_id: number;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  created_at: Date;
}

interface WebhookDeliveryRecord {
  id: number;
  webhook_id: number;
  event: string;
  payload: Record<string, unknown>;
  response_status: number | null;
  created_at: Date;
}

export type { WebhookDeliveryRecord, WebhookRecord };
