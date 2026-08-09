import { describe, expect, test } from "bun:test";
import BaseRepository from "../../../src/core/database/baseRepository";
import { Model, registerModelRepository } from "../../../src/core/database/model";
import { defineTable } from "../../../src/core/database/table";

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

class SoftArticleRepository extends BaseRepository<SoftArticle, "id"> {
  constructor(connection: FakeConnection) {
    super(softTable, connection);
  }
}

class SoftArticleModelBase extends Model<SoftArticle, "id"> {
  static override $fillable = ["title"] as const;

  protected override primaryKey(): "id" {
    return "id";
  }
}

class SoftArticleModelForTest extends SoftArticleModelBase {}

describe("Model soft deletes", () => {
  test("delete soft-deletes when table supports it", async () => {
    const connection = new FakeConnection();
    const repository = new SoftArticleRepository(connection);
    const SoftArticleModel = registerModelRepository(SoftArticleModelForTest, repository);

    const article = new SoftArticleModel(
      {
        id: 1,
        title: "Archived",
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
      repository,
    );

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

  test("restore clears deleted_at", async () => {
    const connection = new FakeConnection();
    const repository = new SoftArticleRepository(connection);
    const SoftArticleModel = registerModelRepository(SoftArticleModelForTest, repository);

    const article = new SoftArticleModel(
      {
        id: 1,
        title: "Back",
        deleted_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      },
      repository,
    );

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
