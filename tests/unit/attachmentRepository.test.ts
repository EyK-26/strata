import { afterEach, describe, expect, test } from "bun:test";
import type { DatabaseConnection } from "../../src/db/connection";
import { resetDatabaseConnectionForTests } from "../../src/db/connection";
import AttachmentRepository from "../../src/modules/attachment/repository";
import type { AttachmentRecord } from "../../src/modules/attachment/types";
import { restoreDefaultDatabaseConnection } from "./testHelpers";

class FakeConnection {
  readonly calls: Array<{ query: string; params: readonly unknown[] }> = [];
  private readonly responses: unknown[][] = [];

  queue(rows: unknown[]): void {
    this.responses.push(rows);
  }

  async unsafe<T>(query: string, params: readonly unknown[] = []): Promise<T[]> {
    this.calls.push({ query, params: [...params] });
    return (this.responses.shift() ?? []) as T[];
  }

  async begin<T>(callback: (transaction: FakeConnection) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

const now = new Date("2026-01-01T00:00:00.000Z");

const attachment: AttachmentRecord = {
  id: 1,
  task_id: 10,
  tenant_id: 1,
  user_id: 2,
  original_name: "notes.txt",
  storage_path: "attachments/task-10/notes.txt",
  mime_type: "text/plain",
  size_bytes: 5,
  created_at: now,
  deleted_at: null,
};

describe("AttachmentRepository", () => {
  afterEach(async () => {
    await restoreDefaultDatabaseConnection();
  });

  test("findByTaskId returns attachments for a task", async () => {
    const connection = new FakeConnection();
    resetDatabaseConnectionForTests(connection as unknown as DatabaseConnection);
    connection.queue([attachment]);

    const repository = new AttachmentRepository().withConnection(connection as never);
    const results = await repository.findByTaskId(10);

    expect(results).toEqual([attachment]);
    expect(connection.calls[0]?.query).toContain('"task_id" = $1');
    expect(connection.calls[0]?.params).toEqual([10]);
  });
});
