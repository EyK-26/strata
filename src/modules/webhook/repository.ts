import { BaseRepository } from "../../core/database";
import type { QueryWhere } from "../../core/database/types";
import { webhookTable } from "./table";
import type { WebhookRecord } from "./types";

class WebhookRepository extends BaseRepository<WebhookRecord, "id"> {
  constructor() {
    super(webhookTable);
  }

  async listActive(): Promise<WebhookRecord[]> {
    return await this.findWhere({ active: true } as unknown as QueryWhere<WebhookRecord>);
  }
}

export default WebhookRepository;
