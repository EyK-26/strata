import { describe, expect, test } from "bun:test";
import type { DatabaseConnection } from "@getstrata/core/database/baseRepository";
import WebhookRepository from "../../src/modules/webhook/repository";

class FakeConnection implements DatabaseConnection {
  readonly calls: Array<{ query: string; params: readonly unknown[] }> = [];
  constructor(private readonly rows: unknown[]) {}

  async unsafe<T>(query: string, params: readonly unknown[] = []): Promise<T[]> {
    this.calls.push({ query, params: [...params] });
    return this.rows as T[];
  }
}

describe("WebhookRepository", () => {
  test("findDeliveryById returns the matching delivery row", async () => {
    const delivery = {
      id: 4,
      webhook_id: 2,
      event: "task.created",
      payload: { id: 11 },
      response_status: 200,
      created_at: new Date(),
    };
    const connection = new FakeConnection([delivery]);
    const repository = new WebhookRepository().withConnection(connection);

    await expect(repository.findDeliveryById(4)).resolves.toEqual(delivery);
    expect(connection.calls[0]?.params).toEqual([4]);
  });

  test("findDeliveryById returns null when no row matches", async () => {
    const connection = new FakeConnection([]);
    const repository = new WebhookRepository().withConnection(connection);

    await expect(repository.findDeliveryById(99)).resolves.toBeNull();
  });
});
