import { describe, expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import {
  filterMassAssignable,
  hydrateValue,
  Model,
  registerModelRepository,
} from "@getstrata/core/database/model";
import { belongsTo, hasMany } from "@getstrata/core/database/relationships";
import { defineTable } from "@getstrata/core/database/table";
import { NotFoundError } from "@getstrata/core/errors/http";

interface Article {
  id: number;
  title: string;
  body: string;
  meta: Record<string, unknown> | null;
  published: boolean;
  created_at: Date;
  updated_at: Date;
}

interface Comment {
  id: number;
  article_id: number;
  body: string;
}

const articleTable = defineTable<Article, "id">({
  name: "articles",
  primaryKey: "id",
  columns: ["id", "title", "body", "meta", "published", "created_at", "updated_at"],
});

const commentTable = defineTable<Comment, "id">({
  name: "comments",
  primaryKey: "id",
  columns: ["id", "article_id", "body"],
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

class ArticleRepository extends BaseRepository<Article, "id"> {
  constructor(connection: FakeConnection) {
    super(articleTable, connection);
  }
}

class CommentRepository extends BaseRepository<Comment, "id"> {
  constructor(connection: FakeConnection) {
    super(commentTable, connection);
  }
}

class ArticleModelBase extends Model<Article, "id"> {
  static override $fillable = ["title", "body", "meta", "published"] as const;
  static override $casts = {
    meta: "json",
    published: "bool",
    created_at: "datetime",
    updated_at: "datetime",
  } as const;

  protected override primaryKey(): "id" {
    return "id";
  }
}

function createArticleModel(connection: FakeConnection): typeof ArticleModelBase {
  class ArticleModelForTest extends ArticleModelBase {}
  return registerModelRepository(
    ArticleModelForTest,
    new ArticleRepository(connection),
  ) as typeof ArticleModelBase;
}

describe("Model mass assignment", () => {
  test("fillable restricts assignable keys", () => {
    const filtered = filterMassAssignable(ArticleModelBase.$fillable, ArticleModelBase.$guarded, {
      id: 99,
      title: "Hello",
      body: "World",
      created_at: new Date(),
    });

    expect(filtered).toEqual({
      title: "Hello",
      body: "World",
    });
  });

  test("guarded blocks all keys when set to true", () => {
    expect(filterMassAssignable(undefined, true, { title: "Blocked" })).toEqual({});
  });
});

describe("Model casts", () => {
  test("hydrates json and bool values", () => {
    expect(hydrateValue('{"a":1}', "json")).toEqual({ a: 1 });
    expect(hydrateValue("true", "bool")).toBe(true);
    expect(hydrateValue("2026-01-01T00:00:00.000Z", "datetime")).toEqual(
      new Date("2026-01-01T00:00:00.000Z"),
    );
  });
});

describe("Model persistence", () => {
  test("create inserts with timestamps and casts", async () => {
    const connection = new FakeConnection();
    const ModelClass = createArticleModel(connection);

    connection.queue([
      {
        id: 1,
        title: "Draft",
        body: "Content",
        meta: '{"tags":["a"]}',
        published: true,
        created_at: new Date("2026-01-01T00:00:00.000Z"),
        updated_at: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    const article = (await ModelClass.create({
      title: "Draft",
      body: "Content",
      meta: { tags: ["a"] },
      published: true,
    })) as unknown as Model<Article, "id">;

    expect(article.id).toBe(1);
    expect(article.get("meta")).toEqual({ tags: ["a"] });
    expect(article.get("published")).toBe(true);
    expect(connection.calls[0]?.query).toContain("INSERT");
  });

  test("save updates an existing record", async () => {
    const connection = new FakeConnection();
    const ModelClass = createArticleModel(connection);

    const article = new ModelClass(
      {
        id: 1,
        title: "Before",
        body: "Old",
        meta: null,
        published: false,
        created_at: new Date("2026-01-01T00:00:00.000Z"),
        updated_at: new Date("2026-01-01T00:00:00.000Z"),
      },
      ModelClass.repository(),
      true,
    );

    connection.queue([
      {
        id: 1,
        title: "After",
        body: "Old",
        meta: null,
        published: false,
        created_at: new Date("2026-01-01T00:00:00.000Z"),
        updated_at: new Date("2026-01-02T00:00:00.000Z"),
      },
    ]);

    article.mergeAttributes({ title: "After" });
    await article.save();

    expect(article.get("title")).toBe("After");
    expect(connection.calls[0]?.query).toContain("UPDATE");
  });

  test("update merges assignable changes and persists", async () => {
    const connection = new FakeConnection();
    const ModelClass = createArticleModel(connection);

    const article = new ModelClass(
      {
        id: 2,
        title: "Keep",
        body: "Old",
        meta: null,
        published: false,
        created_at: new Date(),
        updated_at: new Date(),
      },
      ModelClass.repository(),
    );

    connection.queue([
      {
        id: 2,
        title: "Keep",
        body: "New body",
        meta: null,
        published: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    await article.update({ body: "New body", published: true });

    expect(article.get("body")).toBe("New body");
    expect(article.get("published")).toBe(true);
  });

  test("delete removes a record", async () => {
    const connection = new FakeConnection();
    const ModelClass = createArticleModel(connection);

    const article = new ModelClass(
      {
        id: 3,
        title: "Delete me",
        body: "",
        meta: null,
        published: false,
        created_at: new Date(),
        updated_at: new Date(),
      },
      ModelClass.repository(),
    );

    connection.queue([{ deleted_id: 3 }]);

    expect(await article.delete()).toBe(true);
    expect(connection.calls[0]?.query).toContain("DELETE");
  });
});

describe("Model queries", () => {
  test("findOrFail throws NotFoundError by default", async () => {
    const connection = new FakeConnection();
    const ModelClass = createArticleModel(connection);

    connection.queue([]);

    await expect(ModelClass.findOrFail(404)).rejects.toThrow(NotFoundError);
  });

  test("global scopes apply to query()", async () => {
    const connection = new FakeConnection();

    class ScopedArticleModel extends ArticleModelBase {
      static override boot(): void {
        ScopedArticleModel.addGlobalScope("publishedOnly", (query) =>
          query.where({ published: true }),
        );
      }
    }

    const ScopedModelClass = registerModelRepository(
      ScopedArticleModel,
      new ArticleRepository(connection),
    );

    connection.queue([
      {
        id: 1,
        title: "Live",
        body: "",
        meta: null,
        published: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    const rows = await ScopedModelClass.query().get();

    expect(rows).toHaveLength(1);
    expect(connection.calls[0]?.query).toContain('"published"');
  });
});

describe("Model relationships", () => {
  test("loadHasMany attaches related records", async () => {
    const connection = new FakeConnection();
    const articleRepository = new ArticleRepository(connection);
    const commentRepository = new CommentRepository(connection);
    const ModelClass = createArticleModel(connection);

    const article = new ModelClass(
      {
        id: 1,
        title: "Parent",
        body: "",
        meta: null,
        published: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
      articleRepository,
    );

    const relation = hasMany<Article, Comment, "id", "article_id">({
      name: "comments",
      localKey: "id",
      foreignKey: "article_id",
    });

    connection.queue([{ id: 10, article_id: 1, body: "Nice post" }]);

    const loaded = await article.loadHasMany("comments", relation, commentRepository);
    expect(loaded.comments).toEqual([{ id: 10, article_id: 1, body: "Nice post" }]);
  });

  test("loadBelongsTo attaches the parent record", async () => {
    const connection = new FakeConnection();
    const articleRepository = new ArticleRepository(connection);
    const commentRepository = new CommentRepository(connection);

    class CommentModel extends Model<Comment, "id"> {
      protected override primaryKey(): "id" {
        return "id";
      }
    }

    const comment = new CommentModel({ id: 10, article_id: 1, body: "Reply" }, commentRepository);
    const relation = belongsTo<Comment, Article, "article_id", "id">({
      name: "article",
      foreignKey: "article_id",
      ownerKey: "id",
    });

    connection.queue([
      {
        id: 1,
        title: "Parent",
        body: "",
        meta: null,
        published: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    const loaded = await comment.loadBelongsTo("article", relation, articleRepository);
    expect(loaded.article?.title).toBe("Parent");
  });
});
