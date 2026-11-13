import { expect, test } from "bun:test";
import { service } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineRepository, type ModelObserver } from "@getstrata/core/database/definitions";
import { defineModel, Model } from "@getstrata/core/database/model";
import type { DatabaseSession } from "@getstrata/core/database/session";
import { defineTable } from "@getstrata/core/database/table";
import { withNestedMorphDatabase } from "../../helpers/nestedMorphHarness";

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

function declarations(restrictVisibility: boolean, enableObservers: boolean) {
  class ArticleOwner extends Model<Owner, "id"> {
    children() {
      return this.hasMany(articleDefinition, "owner_id");
    }
    #kind = "article";
    kind() {
      return this.#kind;
    }
  }
  class VideoOwner extends Model<Owner, "id"> {
    #kind = "video";
    kind() {
      return this.#kind;
    }
  }
  class Article extends Model<Subject, "id"> {
    owner() {
      return this.belongsTo(articleownerDefinition, "owner_id");
    }
  }
  class Video extends Model<Subject, "id"> {
    owner() {
      return this.belongsTo(videoownerDefinition, "owner_id");
    }
  }
  class VideoWithoutOwner extends Model<Subject, "id"> {}
  class CommentModel extends Model<Comment, "id"> {
    subject() {
      return this.morphTo({ article: articleDefinition, video: videoDefinition }, "subject");
    }
  }
  class CommentWithMissingRelation extends Model<Comment, "id"> {
    subject() {
      return this.morphTo(
        { article: articleDefinition, video: videowithoutownerDefinition },
        "subject",
      );
    }
  }
  const observers: {
    Article?: ModelObserver<Article>;
    CommentModel?: ModelObserver<CommentModel>;
  } = {};
  const articleObserver = createServiceToken<ModelObserver<Article>>("Article.observer");
  const commentObserver = createServiceToken<ModelObserver<CommentModel>>("Comment.observer");
  const articleownerRepository = defineRepository({
    name: "ArticleOwner.repo",
    table: articleOwners,
    dependencies: [] as const,
    create: (binding) => new BaseRepository(binding),
  });
  const articleownerDefinition = defineModel({
    name: "ArticleOwner",
    repository: articleownerRepository,
    dependencies: [] as const,
    attributes: {},
    scopes: restrictVisibility ? [(query) => query.where({ id: 1 })] : [],
    construct: (state, binding) => new ArticleOwner(state, binding),
  });
  const videoownerRepository = defineRepository({
    name: "VideoOwner.repo",
    table: videoOwners,
    dependencies: [] as const,
    create: (binding) => new BaseRepository(binding),
  });
  const videoownerDefinition = defineModel({
    name: "VideoOwner",
    repository: videoownerRepository,
    dependencies: [] as const,
    attributes: {},
    scopes: restrictVisibility ? [(query) => query.where({ id: 2 })] : [],
    construct: (state, binding) => new VideoOwner(state, binding),
  });
  const articleRepository = defineRepository({
    name: "Article.repo",
    table: articles,
    dependencies: [] as const,
    create: (binding) => new BaseRepository(binding),
  });
  const articleDefinition = defineModel({
    name: "Article",
    repository: articleRepository,
    dependencies: [] as const,
    attributes: {},
    observers: enableObservers ? [articleObserver] : [],
    scopes: restrictVisibility ? [(query) => query.where({ id: 1 })] : [],
    construct: (state, binding) => new Article(state, binding),
  });
  const videoRepository = defineRepository({
    name: "Video.repo",
    table: videos,
    dependencies: [] as const,
    create: (binding) => new BaseRepository(binding),
  });
  const videoDefinition = defineModel({
    name: "Video",
    repository: videoRepository,
    dependencies: [] as const,
    attributes: {},
    construct: (state, binding) => new Video(state, binding),
  });
  const videowithoutownerRepository = defineRepository({
    name: "VideoWithoutOwner.repo",
    table: videos,
    dependencies: [] as const,
    create: (binding) => new BaseRepository(binding),
  });
  const videowithoutownerDefinition = defineModel({
    name: "VideoWithoutOwner",
    repository: videowithoutownerRepository,
    dependencies: [] as const,
    attributes: {},
    construct: (state, binding) => new VideoWithoutOwner(state, binding),
  });
  const commentmodelRepository = defineRepository({
    name: "CommentModel.repo",
    table: comments,
    dependencies: [] as const,
    create: (binding) => new BaseRepository(binding),
  });
  const commentmodelDefinition = defineModel({
    name: "CommentModel",
    repository: commentmodelRepository,
    dependencies: [] as const,
    attributes: {},
    observers: enableObservers ? [commentObserver] : [],
    construct: (state, binding) => new CommentModel(state, binding),
  });
  const commentwithmissingrelationRepository = defineRepository({
    name: "CommentWithMissingRelation.repo",
    table: comments,
    dependencies: [] as const,
    create: (binding) => new BaseRepository(binding),
  });
  const commentwithmissingrelationDefinition = defineModel({
    name: "CommentWithMissingRelation",
    repository: commentwithmissingrelationRepository,
    dependencies: [] as const,
    attributes: {},
    construct: (state, binding) => new CommentWithMissingRelation(state, binding),
  });
  return {
    observers,
    services: [
      service(articleObserver, {
        lifetime: "application",
        dependencies: [] as const,
        create: () => ({
          get retrieved() {
            return observers.Article?.retrieved;
          },
        }),
      }),
      service(commentObserver, {
        lifetime: "application",
        dependencies: [] as const,
        create: () => ({
          get retrieved() {
            return observers.CommentModel?.retrieved;
          },
        }),
      }),
    ],
    repositories: [
      articleownerRepository,
      videoownerRepository,
      articleRepository,
      videoRepository,
      videowithoutownerRepository,
      commentmodelRepository,
      commentwithmissingrelationRepository,
    ],
    models: [
      articleownerDefinition,
      videoownerDefinition,
      articleDefinition,
      videoDefinition,
      videowithoutownerDefinition,
      commentmodelDefinition,
      commentwithmissingrelationDefinition,
    ],
    ArticleOwner,
    articleownerDefinition,
    VideoOwner,
    videoownerDefinition,
    Article,
    articleDefinition,
    Video,
    videoDefinition,
    VideoWithoutOwner,
    videowithoutownerDefinition,
    CommentModel,
    commentmodelDefinition,
    CommentWithMissingRelation,
    commentwithmissingrelationDefinition,
  };
}
function bindGraph(database: DatabaseSession, graph: ReturnType<typeof declarations>) {
  return {
    observers: graph.observers,
    ArticleOwner: database.model(graph.articleownerDefinition),
    ArticleOwnerClass: graph.ArticleOwner,
    VideoOwner: database.model(graph.videoownerDefinition),
    VideoOwnerClass: graph.VideoOwner,
    Article: database.model(graph.articleDefinition),
    ArticleClass: graph.Article,
    Video: database.model(graph.videoDefinition),
    VideoClass: graph.Video,
    VideoWithoutOwner: database.model(graph.videowithoutownerDefinition),
    VideoWithoutOwnerClass: graph.VideoWithoutOwner,
    CommentModel: database.model(graph.commentmodelDefinition),
    CommentModelClass: graph.CommentModel,
    CommentWithMissingRelation: database.model(graph.commentwithmissingrelationDefinition),
    CommentWithMissingRelationClass: graph.CommentWithMissingRelation,
  };
}
async function fixture<T>(
  work: (graph: ReturnType<typeof bindGraph> & { queries: string[] }) => T | Promise<T>,
  restrictVisibility = false,
  enableObservers = false,
) {
  const graph = declarations(restrictVisibility, enableObservers);
  const queries: string[] = [];
  return withNestedMorphDatabase(
    {
      definition: {
        default: "test",
        connections: { test: { driver: "sqlite", filename: ":memory:" } },
        repositories: graph.repositories,
        models: graph.models,
      },
      services: graph.services,
      observe: (statement) => queries.push(statement.text),
      schema: (schema) => {
        for (const name of [articleOwners.name, videoOwners.name])
          schema.create(name, (table) => {
            table.id();
            table.string("name");
          });
        for (const name of [articles.name, videos.name])
          schema.create(name, (table) => {
            table.id();
            table.integer("owner_id");
          });
        schema.create(comments.name, (table) => {
          table.id();
          table.string("subject_type");
          table.integer("subject_id");
        });
      },
    },
    async (database) => {
      const f = bindGraph(database, graph);
      for (const id of [1, 2]) {
        await f.ArticleOwner.repository().create({ id, name: `article-${id}` });
        await f.VideoOwner.repository().create({ id, name: `video-${id}` });
        await f.Article.repository().create({ id, owner_id: id });
        await f.Video.repository().create({ id, owner_id: id });
        await f.CommentModel.repository().create({
          id: id * 2 - 1,
          subject_type: "article",
          subject_id: id,
        });
        await f.CommentModel.repository().create({
          id: id * 2,
          subject_type: "video",
          subject_id: id,
        });
      }
      queries.length = 0;
      return work({ ...f, queries });
    },
  );
}

for (const sameName of [false, true]) {
  for (const direction of ["ASC", "DESC"] as const) {
    test(`nested morph loading retains each target's relation owner in ${direction} order${sameName ? " with identical class names" : ""}`, async () => {
      await fixture(async (f) => {
        if (sameName) {
          Object.defineProperty(f.ArticleClass, "name", { value: "Subject" });
          Object.defineProperty(f.VideoClass, "name", { value: "Subject" });
        }
        const rows = await f.CommentModel.query()
          .with("subject.owner")
          .orderBy({ column: "id", direction })
          .get();
        const owners: string[] = [];
        for (const row of rows) {
          const subject = row.loaded<
            InstanceType<typeof f.ArticleClass> | InstanceType<typeof f.VideoClass>
          >("subject");
          expect(subject).toBeDefined();
          if (!subject) throw new Error("Expected the morph target.");
          const owner = subject.loaded<
            InstanceType<typeof f.ArticleOwnerClass> | InstanceType<typeof f.VideoOwnerClass>
          >("owner");
          expect(owner).toBeDefined();
          if (!owner) throw new Error("Expected the target's own relation.");
          owners.push(owner.get("name"));
          expect(owner.kind()).toBe(row.get("subject_type"));
          expect(owner).toBeInstanceOf(
            row.get("subject_type") === "article" ? f.ArticleOwnerClass : f.VideoOwnerClass,
          );
        }
        const expected = ["article-1", "video-1", "article-2", "video-2"];
        expect(owners).toEqual(direction === "ASC" ? expected : expected.toReversed());
        // Root + two morph target tables + two nested owner tables, independent of row count.
        expect(f.queries).toHaveLength(5);
      });
    });
  }
}

for (const paths of [
  ["subject", "subject.owner"],
  ["subject.owner", "subject"],
]) {
  test(`flat and nested registrations keep nested model hydration: ${paths.join(", ")}`, async () => {
    await fixture(async (f) => {
      const rows = await f.CommentModel.query().with(paths).orderBy({ column: "id" }).get();
      for (const row of rows) {
        const subject = row.loaded<
          InstanceType<typeof f.ArticleClass> | InstanceType<typeof f.VideoClass>
        >("subject");
        const owner = subject?.loaded<
          InstanceType<typeof f.ArticleOwnerClass> | InstanceType<typeof f.VideoOwnerClass>
        >("owner");
        expect(owner?.kind()).toBe(row.get("subject_type"));
      }
    });
  });
}

test("nested morph targets and their distinct owner scopes cannot expose hidden rows", async () => {
  await fixture(async (f) => {
    /* restricted */
    const rows = await f.CommentModel.query().with("subject.owner").orderBy({ column: "id" }).get();
    const subjects = rows.map((row) =>
      row.loaded<InstanceType<typeof f.ArticleClass> | InstanceType<typeof f.VideoClass>>(
        "subject",
      ),
    );
    expect(subjects[2]).toBeUndefined();
    expect(subjects[0]?.loaded<InstanceType<typeof f.ArticleOwnerClass>>("owner")?.kind()).toBe(
      "article",
    );
    expect(subjects[1]).toBeInstanceOf(f.VideoClass);
    expect(subjects[1]?.loaded("owner")).toBeUndefined();
    expect(subjects[3]?.loaded<InstanceType<typeof f.VideoOwnerClass>>("owner")?.kind()).toBe(
      "video",
    );
    expect(f.queries).toHaveLength(5);
  }, true);
});

test("flat eager morph-to records and the two-argument hydration call keep their shape", async () => {
  await fixture(async (f) => {
    const rows = await f.CommentModel.query().with("subject").orderBy({ column: "id" }).get();
    for (const row of rows) {
      const value = row.loaded<Subject>("subject");
      expect(value).toEqual({ id: row.get("subject_id"), owner_id: row.get("subject_id") });
      if (!value) throw new Error("Expected the flat record.");
      expect(Reflect.get(value, "get")).toBeUndefined();
    }
    const relation = f.CommentModel.hydrate({
      id: 1,
      subject_type: "article",
      subject_id: 1,
    }).subject();
    expect(relation.hydrateEager({ subject: { id: 1, owner_id: 1 } }, "subject")).toEqual({
      id: 1,
      owner_id: 1,
    });
  });
});

test("a flat lazy morph-to load still returns the concrete model", async () => {
  await fixture(async (f) => {
    const row = await f.CommentModel.findOrFail(1);
    await row.load("subject");
    expect(row.loaded("subject")).toBeInstanceOf(f.ArticleClass);
  });
});

test("a later morph target with no nested relation reports its own missing method", async () => {
  await fixture(async (f) => {
    await expect(
      f.CommentWithMissingRelation.query().with("subject.owner").orderBy({ column: "id" }).get(),
    ).rejects.toThrow("VideoWithoutOwner has no relation method owner().");
  });
});

test("lazy nested loads keep the existing typed relation methods and private state", async () => {
  await fixture(async (f) => {
    const rows = await f.CommentModel.query().orderBy({ column: "id" }).get();
    for (const row of rows) {
      await row.load("subject.owner");
      const subject = row.loaded<
        InstanceType<typeof f.ArticleClass> | InstanceType<typeof f.VideoClass>
      >("subject");
      const owner = subject?.loaded<
        InstanceType<typeof f.ArticleOwnerClass> | InstanceType<typeof f.VideoOwnerClass>
      >("owner");
      expect(owner?.kind()).toBe(row.get("subject_type"));
    }
  });
});

test("an already eager flat morph record can load a nested owner without refreshing the cached target", async () => {
  await fixture(async (f) => {
    const rows = await f.CommentModel.query().with("subject").orderBy({ column: "id" }).get();
    const row = rows[0];
    if (!row) throw new Error("Expected the first comment.");
    expect(row.loaded("subject")).toEqual({ id: 1, owner_id: 1 });
    await f.Article.repository().updateById(1, { owner_id: 2 });
    f.queries.length = 0;
    await row.load("subject.owner");
    const subject = row.loaded<InstanceType<typeof f.ArticleClass>>("subject");
    expect(subject).toBeInstanceOf(f.ArticleClass);
    expect(subject?.toObject()).toEqual({ id: 1, owner_id: 1 });
    const owner = subject?.loaded<InstanceType<typeof f.ArticleOwnerClass>>("owner");
    expect(owner?.kind()).toBe("article");
    expect(owner?.get("name")).toBe("article-1");
    expect(f.queries).toHaveLength(1);
  });
});

test("retrieved observers can invalidate a present eager relation before ordinary nested traversal", async () => {
  await fixture(
    async (f) => {
      f.observers.Article = {
        retrieved(model) {
          model.setLoaded("owner", undefined);
        },
      };
      const rows = await f.Article.query().with("owner.children").orderBy({ column: "id" }).get();
      expect(
        rows.map((row) =>
          row
            .loaded<InstanceType<typeof f.ArticleOwnerClass>>("owner")
            ?.loaded<Array<InstanceType<typeof f.ArticleClass>>>("children")
            ?.map((child) => child.id),
        ),
      ).toEqual([[1], [2]]);
      expect(f.queries).toHaveLength(4);
    },
    false,
    true,
  );
});

test("retrieved observers can invalidate a present morph target before nested traversal", async () => {
  await fixture(
    async (f) => {
      f.observers.CommentModel = {
        retrieved(model) {
          model.setLoaded("subject", undefined);
        },
      };
      const rows = await f.CommentModel.query()
        .with("subject.owner")
        .orderBy({ column: "id" })
        .get();
      const names = rows.map((row) =>
        row
          .loaded<InstanceType<typeof f.ArticleClass> | InstanceType<typeof f.VideoClass>>(
            "subject",
          )
          ?.loaded<
            InstanceType<typeof f.ArticleOwnerClass> | InstanceType<typeof f.VideoOwnerClass>
          >("owner")
          ?.get("name"),
      );
      expect(names).toEqual(["article-1", "video-1", "article-2", "video-2"]);
      expect(f.queries).toHaveLength(7);
    },
    false,
    true,
  );
});

test("retrieved observers can materialize an initially absent morph target", async () => {
  await fixture(
    async (f) => {
      await f.Article.repository().deleteById(2);
      f.observers.CommentModel = {
        async retrieved(model) {
          if (Number(model.id) === 3) {
            await f.Article.repository().create({ id: 2, owner_id: 2 });
            model.setLoaded("subject", undefined);
          }
        },
      };
      const rows = await f.CommentModel.query()
        .with("subject.owner")
        .orderBy({ column: "id" })
        .get();
      expect(
        rows.map((row) =>
          row
            .loaded<InstanceType<typeof f.ArticleClass> | InstanceType<typeof f.VideoClass>>(
              "subject",
            )
            ?.loaded<
              InstanceType<typeof f.ArticleOwnerClass> | InstanceType<typeof f.VideoOwnerClass>
            >("owner")
            ?.get("name"),
        ),
      ).toEqual(["article-1", "video-1", "article-2", "video-2"]);
    },
    false,
    true,
  );
});

test("retrieved observer accessors are evaluated once for each normal model hydration", async () => {
  await fixture(
    async (f) => {
      let reads = 0;
      let calls = 0;
      f.observers.CommentModel = {
        get retrieved() {
          reads++;
          return () => {
            calls++;
          };
        },
      };
      const rows = await f.CommentModel.query().orderBy({ column: "id" }).get();
      expect(rows).toHaveLength(4);
      expect(calls).toBe(4);
      expect(reads).toBe(4);
    },
    false,
    true,
  );
});
