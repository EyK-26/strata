import { describe, expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import {
  type BoundModel,
  defineModel,
  defineRepository,
} from "@getstrata/core/database/definitions";
import { Model } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";
import { withBoundDatabase } from "../../helpers/boundRepositoryHarness";

interface SoftArticle {
  id: number;
  title: string;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const softTable = defineTable<SoftArticle, "id">({
  name: "soft_articles",
  primaryKey: "id",
  columns: ["id", "title", "deleted_at", "created_at", "updated_at"],
  softDeletes: true,
});

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
}

class SoftArticleModelForTest extends Model<SoftArticle, "id"> {}
const repository = defineRepository({
  name: "articles",
  table: softTable,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const definition = defineModel({
  name: "SoftArticle",
  repository,
  dependencies: [],
  attributes: { fillable: ["title"] },
  construct: (state, binding) => new SoftArticleModelForTest(state, binding),
});
async function fixture(
  connection: FakeConnection,
  work: (model: BoundModel<SoftArticle, "id", SoftArticleModelForTest>) => Promise<void>,
) {
  await withBoundDatabase(
    {
      definition: {
        default: "main",
        connections: { main: { driver: "sqlite", filename: ":memory:" } },
        repositories: [repository],
        models: [definition],
      },
      connection,
    },
    (db) => work(db.model(definition)),
  );
}

describe("Model soft deletes", () => {
  test("delete soft-deletes when table supports it", async () => {
    const connection = new FakeConnection();
    await fixture(connection, async (SoftArticleModel) => {
      const article = SoftArticleModel.hydrate({
        id: 1,
        title: "Archived",
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      connection.queue([
        {
          id: 1,
          title: "Archived",
          deleted_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

      expect(await article.delete()).toBe(true);
      expect(connection.calls[0]?.query).toContain("UPDATE");
      expect(connection.calls[0]?.query).toContain('"deleted_at"');
    });
  });

  test("restore clears deleted_at", async () => {
    const connection = new FakeConnection();
    await fixture(connection, async (SoftArticleModel) => {
      const article = SoftArticleModel.hydrate({
        id: 1,
        title: "Back",
        deleted_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      });

      connection.queue([
        {
          id: 1,
          title: "Back",
          deleted_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

      const restored = await article.restore();
      expect(restored?.get("deleted_at")).toBeNull();
    });
  });
});
