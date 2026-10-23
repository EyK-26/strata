import { expect, test } from "bun:test";
import { BaseRepository, type DatabaseConnection } from "@getstrata/core/database/baseRepository";
import { resetSqlDialect, useSqlDialect } from "@getstrata/core/database/dialect";
import { defineModel, registerModelRepository } from "@getstrata/core/database/model";
import { Schema } from "@getstrata/core/database/schema";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { defineTable } from "@getstrata/core/database/table";

type Owner = { id: number; name: string };
type Subject = { id: number; owner_id: number };
type Comment = { id: number; subject_type: string; subject_id: number };
const articleOwners = defineTable<Owner, "id">({
  name: "nested_article_owners",
  primaryKey: "id",
  columns: ["id", "name"],
});
const videoOwners = defineTable<Owner, "id">({
  name: "nested_video_owners",
  primaryKey: "id",
  columns: ["id", "name"],
});
const articles = defineTable<Subject, "id">({
  name: "nested_articles",
  primaryKey: "id",
  columns: ["id", "owner_id"],
});
const videos = defineTable<Subject, "id">({
  name: "nested_videos",
  primaryKey: "id",
  columns: ["id", "owner_id"],
});
const comments = defineTable<Comment, "id">({
  name: "nested_comments",
  primaryKey: "id",
  columns: ["id", "subject_type", "subject_id"],
});

async function fixture(restrictVisibility = false) {
  const database = createSqliteConnection(":memory:");
  useSqlDialect("sqlite");
  const queries: string[] = [];
  const connection: DatabaseConnection = {
    async unsafe<Row>(query: string, params: readonly unknown[] = []): Promise<Row[]> {
      queries.push(query);
      return database.unsafe<Row>(query, params);
    },
  };
  await Schema.run(connection, "sqlite", (schema) => {
    for (const name of [articleOwners.name, videoOwners.name]) {
      schema.create(name, (table) => {
        table.id();
        table.string("name");
      });
    }
    for (const name of [articles.name, videos.name]) {
      schema.create(name, (table) => {
        table.id();
        table.integer("owner_id");
      });
    }
    schema.create(comments.name, (table) => {
      table.id();
      table.string("subject_type");
      table.integer("subject_id");
    });
  });
  class ArticleOwner extends defineModel(articleOwners) {
    static override boot() {
      if (restrictVisibility) {
        ArticleOwner.addGlobalScope<Owner, "id">("visible", (query) => query.where({ id: 1 }));
      }
    }
    #kind = "article";
    kind() {
      return this.#kind;
    }
  }
  class VideoOwner extends defineModel(videoOwners) {
    static override boot() {
      if (restrictVisibility) {
        VideoOwner.addGlobalScope<Owner, "id">("visible", (query) => query.where({ id: 2 }));
      }
    }
    #kind = "video";
    kind() {
      return this.#kind;
    }
  }
  class Article extends defineModel(articles) {
    static override boot() {
      if (restrictVisibility) {
        Article.addGlobalScope<Subject, "id">("visible", (query) => query.where({ id: 1 }));
      }
    }
    owner() {
      return this.belongsTo(ArticleOwner, "owner_id");
    }
  }
  class Video extends defineModel(videos) {
    owner() {
      return this.belongsTo(VideoOwner, "owner_id");
    }
  }
  class VideoWithoutOwner extends defineModel(videos) {}
  class CommentModel extends defineModel(comments) {
    subject() {
      return this.morphTo({ article: Article, video: Video }, "subject");
    }
  }
  class CommentWithMissingRelation extends defineModel(comments) {
    subject() {
      return this.morphTo({ article: Article, video: VideoWithoutOwner }, "subject");
    }
  }
  registerModelRepository(ArticleOwner, new BaseRepository(articleOwners, connection));
  registerModelRepository(VideoOwner, new BaseRepository(videoOwners, connection));
  registerModelRepository(Article, new BaseRepository(articles, connection));
  registerModelRepository(Video, new BaseRepository(videos, connection));
  registerModelRepository(VideoWithoutOwner, new BaseRepository(videos, connection));
  registerModelRepository(CommentModel, new BaseRepository(comments, connection));
  registerModelRepository(CommentWithMissingRelation, new BaseRepository(comments, connection));

  for (const id of [1, 2]) {
    await ArticleOwner.repository().create({ id, name: `article-${id}` });
    await VideoOwner.repository().create({ id, name: `video-${id}` });
    await Article.repository().create({ id, owner_id: id });
    await Video.repository().create({ id, owner_id: id });
    await CommentModel.repository().create({
      id: id * 2 - 1,
      subject_type: "article",
      subject_id: id,
    });
    await CommentModel.repository().create({ id: id * 2, subject_type: "video", subject_id: id });
  }
  queries.length = 0;
  return {
    database,
    queries,
    CommentModel,
    CommentWithMissingRelation,
    Article,
    Video,
    ArticleOwner,
    VideoOwner,
  };
}

for (const sameName of [false, true]) {
  for (const direction of ["ASC", "DESC"] as const) {
    test(`nested morph loading retains each target's relation owner in ${direction} order${sameName ? " with identical class names" : ""}`, async () => {
      const f = await fixture();
      try {
        if (sameName) {
          Object.defineProperty(f.Article, "name", { value: "Subject" });
          Object.defineProperty(f.Video, "name", { value: "Subject" });
        }
        const rows = await f.CommentModel.query()
          .with("subject.owner")
          .orderBy({ column: "id", direction })
          .get();
        const owners: string[] = [];
        for (const row of rows) {
          const subject = row.loaded<InstanceType<typeof f.Article> | InstanceType<typeof f.Video>>(
            "subject",
          );
          expect(subject).toBeDefined();
          if (!subject) throw new Error("Expected the morph target.");
          const owner = subject.loaded<
            InstanceType<typeof f.ArticleOwner> | InstanceType<typeof f.VideoOwner>
          >("owner");
          expect(owner).toBeDefined();
          if (!owner) throw new Error("Expected the target's own relation.");
          owners.push(owner.get("name"));
          expect(owner.kind()).toBe(row.get("subject_type"));
          expect(owner).toBeInstanceOf(
            row.get("subject_type") === "article" ? f.ArticleOwner : f.VideoOwner,
          );
        }
        const expected = ["article-1", "video-1", "article-2", "video-2"];
        expect(owners).toEqual(direction === "ASC" ? expected : expected.toReversed());
        // Root + two morph target tables + two nested owner tables, independent of row count.
        expect(f.queries).toHaveLength(5);
      } finally {
        f.database.close();
        resetSqlDialect();
      }
    });
  }
}

for (const paths of [
  ["subject", "subject.owner"],
  ["subject.owner", "subject"],
]) {
  test(`flat and nested registrations keep nested model hydration: ${paths.join(", ")}`, async () => {
    const f = await fixture();
    try {
      const rows = await f.CommentModel.query().with(paths).orderBy({ column: "id" }).get();
      for (const row of rows) {
        const subject = row.loaded<InstanceType<typeof f.Article> | InstanceType<typeof f.Video>>(
          "subject",
        );
        const owner = subject?.loaded<
          InstanceType<typeof f.ArticleOwner> | InstanceType<typeof f.VideoOwner>
        >("owner");
        expect(owner?.kind()).toBe(row.get("subject_type"));
      }
    } finally {
      f.database.close();
      resetSqlDialect();
    }
  });
}

test("nested morph targets and their distinct owner scopes cannot expose hidden rows", async () => {
  const f = await fixture(true);
  try {
    const rows = await f.CommentModel.query().with("subject.owner").orderBy({ column: "id" }).get();
    const subjects = rows.map((row) =>
      row.loaded<InstanceType<typeof f.Article> | InstanceType<typeof f.Video>>("subject"),
    );
    expect(subjects[2]).toBeUndefined();
    expect(subjects[0]?.loaded<InstanceType<typeof f.ArticleOwner>>("owner")?.kind()).toBe(
      "article",
    );
    expect(subjects[1]).toBeInstanceOf(f.Video);
    expect(subjects[1]?.loaded("owner")).toBeUndefined();
    expect(subjects[3]?.loaded<InstanceType<typeof f.VideoOwner>>("owner")?.kind()).toBe("video");
    expect(f.queries).toHaveLength(5);
  } finally {
    f.database.close();
    resetSqlDialect();
  }
});

test("flat eager morph-to records and the two-argument hydration call keep their shape", async () => {
  const f = await fixture();
  try {
    const rows = await f.CommentModel.query().with("subject").orderBy({ column: "id" }).get();
    for (const row of rows) {
      const value = row.loaded<Subject>("subject");
      expect(value).toEqual({ id: row.get("subject_id"), owner_id: row.get("subject_id") });
      if (!value) throw new Error("Expected the flat record.");
      expect(Reflect.get(value, "get")).toBeUndefined();
    }
    const relation = f.CommentModel.newFromRecord({
      id: 1,
      subject_type: "article",
      subject_id: 1,
    }).subject();
    expect(relation.hydrateEager({ subject: { id: 1, owner_id: 1 } }, "subject")).toEqual({
      id: 1,
      owner_id: 1,
    });
  } finally {
    f.database.close();
    resetSqlDialect();
  }
});

test("a flat lazy morph-to load still returns the concrete model", async () => {
  const f = await fixture();
  try {
    const row = await f.CommentModel.findOrFail(1);
    await row.load("subject");
    expect(row.loaded("subject")).toBeInstanceOf(f.Article);
  } finally {
    f.database.close();
    resetSqlDialect();
  }
});

test("a later morph target with no nested relation reports its own missing method", async () => {
  const f = await fixture();
  try {
    await expect(
      f.CommentWithMissingRelation.query().with("subject.owner").orderBy({ column: "id" }).get(),
    ).rejects.toThrow("VideoWithoutOwner has no relation method owner().");
  } finally {
    f.database.close();
    resetSqlDialect();
  }
});

test("lazy nested loads keep the existing typed relation methods and private state", async () => {
  const f = await fixture();
  try {
    const rows = await f.CommentModel.query().orderBy({ column: "id" }).get();
    for (const row of rows) {
      await row.load("subject.owner");
      const subject = row.loaded<InstanceType<typeof f.Article> | InstanceType<typeof f.Video>>(
        "subject",
      );
      const owner = subject?.loaded<
        InstanceType<typeof f.ArticleOwner> | InstanceType<typeof f.VideoOwner>
      >("owner");
      expect(owner?.kind()).toBe(row.get("subject_type"));
    }
  } finally {
    f.database.close();
    resetSqlDialect();
  }
});

test("an already eager flat morph record can load a nested owner without refreshing the cached target", async () => {
  const f = await fixture();
  try {
    const rows = await f.CommentModel.query().with("subject").orderBy({ column: "id" }).get();
    const row = rows[0];
    if (!row) throw new Error("Expected the first comment.");
    expect(row.loaded("subject")).toEqual({ id: 1, owner_id: 1 });
    await f.Article.repository<Subject, "id">().updateById(1, { owner_id: 2 });
    f.queries.length = 0;
    await row.load("subject.owner");
    const subject = row.loaded<InstanceType<typeof f.Article>>("subject");
    expect(subject).toBeInstanceOf(f.Article);
    expect(subject?.toObject()).toEqual({ id: 1, owner_id: 1 });
    const owner = subject?.loaded<InstanceType<typeof f.ArticleOwner>>("owner");
    expect(owner?.kind()).toBe("article");
    expect(owner?.get("name")).toBe("article-1");
    expect(f.queries).toHaveLength(1);
  } finally {
    f.database.close();
    resetSqlDialect();
  }
});
