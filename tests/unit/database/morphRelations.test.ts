import { describe, expect, test } from "bun:test";
import {
  BaseRepository,
  type DatabaseConnection,
  defineTable,
  morphMany,
  morphOne,
  morphTo,
} from "../../../src/core/database";
import {
  indexMorphManyRelation,
  indexMorphOneRelation,
  indexMorphToRelation,
} from "../../../src/core/database/relationships";

type Thread = { id: number; title: string };
type Episode = { id: number; title: string };
type Reaction = {
  id: number;
  user_id: number;
  reactable_type: string;
  reactable_id: number;
  kind: string;
};

const reactionTable = defineTable<Reaction, "id">({
  name: "reactions",
  primaryKey: "id",
  columns: ["id", "user_id", "reactable_type", "reactable_id", "kind"],
});

class ReactionRepository extends BaseRepository<Reaction, "id"> {
  constructor(connection: DatabaseConnection) {
    super(reactionTable, connection);
  }
}

const threadHasReactions = morphMany<Thread, Reaction, "id", "reactable_type", "reactable_id">({
  name: "reactions",
  localKey: "id",
  morphTypeKey: "reactable_type",
  morphIdKey: "reactable_id",
  morphType: "forum_thread",
});

const reactionMorphTo = morphTo<Reaction, "reactable_type", "reactable_id">({
  name: "reactable",
  morphTypeKey: "reactable_type",
  morphIdKey: "reactable_id",
});

class FakeConnection implements DatabaseConnection {
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

describe("morph relation indexing", () => {
  test("indexMorphManyRelation groups children by morph type and id", () => {
    const parents = [
      { id: 1, title: "Thread" },
      { id: 2, title: "Other" },
    ];
    const children = [
      { id: 10, user_id: 1, reactable_type: "forum_thread", reactable_id: 1, kind: "like" },
      { id: 11, user_id: 2, reactable_type: "forum_thread", reactable_id: 1, kind: "like" },
      { id: 12, user_id: 3, reactable_type: "forum_thread", reactable_id: 2, kind: "like" },
      { id: 13, user_id: 4, reactable_type: "learn_episode", reactable_id: 1, kind: "like" },
    ];

    const grouped = indexMorphManyRelation(parents, children, threadHasReactions);

    expect(grouped.get(1)).toHaveLength(2);
    expect(grouped.get(2)).toHaveLength(1);
  });

  test("indexMorphOneRelation returns first child", () => {
    const relation = morphOne<Thread, Reaction, "id", "reactable_type", "reactable_id">({
      name: "featured_reaction",
      localKey: "id",
      morphTypeKey: "reactable_type",
      morphIdKey: "reactable_id",
      morphType: "forum_thread",
    });

    const indexed = indexMorphOneRelation(
      [{ id: 1, title: "Thread" }],
      [
        { id: 10, user_id: 1, reactable_type: "forum_thread", reactable_id: 1, kind: "like" },
        { id: 11, user_id: 2, reactable_type: "forum_thread", reactable_id: 1, kind: "like" },
      ],
      relation,
    );

    expect(indexed.get(1)?.id).toBe(10);
  });

  test("indexMorphToRelation resolves parent by morph map", () => {
    const threads = new Map<number, Thread>([[1, { id: 1, title: "Thread" }]]);
    const episodes = new Map<number, Episode>([[5, { id: 5, title: "Episode" }]]);
    const parentsByType = new Map<string, Map<number, Thread | Episode>>([
      ["forum_thread", threads],
      ["learn_episode", episodes],
    ]);

    const indexed = indexMorphToRelation(
      [
        { id: 10, user_id: 1, reactable_type: "forum_thread", reactable_id: 1, kind: "like" },
        { id: 11, user_id: 2, reactable_type: "learn_episode", reactable_id: 5, kind: "like" },
      ],
      parentsByType,
      reactionMorphTo,
    );

    expect(indexed.get(1)).toEqual({ id: 1, title: "Thread" });
    expect(indexed.get(5)).toEqual({ id: 5, title: "Episode" });
  });
});

describe("morph relation eager loading", () => {
  test("loadMorphManyForParents filters by morph type", async () => {
    const connection = new FakeConnection();
    const reactions = new ReactionRepository(connection);

    connection.queue([
      { id: 10, user_id: 1, reactable_type: "forum_thread", reactable_id: 1, kind: "like" },
      { id: 11, user_id: 2, reactable_type: "forum_thread", reactable_id: 1, kind: "like" },
    ]);

    const grouped = await reactions.loadMorphManyForParents(
      [{ id: 1, title: "Thread" }],
      threadHasReactions,
    );

    expect(grouped.get(1)).toHaveLength(2);
    expect(connection.calls[0]?.params).toContain("forum_thread");
  });

  test("loadMorphManyForParents returns empty groups for no parents", async () => {
    const connection = new FakeConnection();
    const reactions = new ReactionRepository(connection);

    const grouped = await reactions.loadMorphManyForParents([], threadHasReactions);

    expect(grouped.size).toBe(0);
    expect(connection.calls).toHaveLength(0);
  });

  test("loadMorphOneForParents returns the first matching child", async () => {
    const connection = new FakeConnection();
    const reactions = new ReactionRepository(connection);
    const relation = morphOne<Thread, Reaction, "id", "reactable_type", "reactable_id">({
      name: "featured_reaction",
      localKey: "id",
      morphTypeKey: "reactable_type",
      morphIdKey: "reactable_id",
      morphType: "forum_thread",
    });

    connection.queue([
      { id: 10, user_id: 1, reactable_type: "forum_thread", reactable_id: 1, kind: "like" },
      { id: 11, user_id: 2, reactable_type: "forum_thread", reactable_id: 1, kind: "like" },
      { id: 12, user_id: 3, reactable_type: "forum_thread", reactable_id: 2, kind: "like" },
    ]);

    const grouped = await reactions.loadMorphOneForParents(
      [
        { id: 1, title: "Thread" },
        { id: 2, title: "Other" },
      ],
      relation,
    );

    expect(grouped.get(1)?.id).toBe(10);
    expect(grouped.get(2)?.id).toBe(12);
  });

  test("withMorphMany attaches reactions on parent query", async () => {
    const connection = new FakeConnection();
    const reactions = new ReactionRepository(connection);

    const threadTable = defineTable<Thread, "id">({
      name: "forum_threads",
      primaryKey: "id",
      columns: ["id", "title"],
    });

    class ThreadRepository extends BaseRepository<Thread, "id"> {
      constructor(conn: DatabaseConnection) {
        super(threadTable, conn);
      }
    }

    const threads = new ThreadRepository(connection);

    connection.queue([{ id: 1, title: "Thread" }]);
    connection.queue([
      { id: 10, user_id: 1, reactable_type: "forum_thread", reactable_id: 1, kind: "like" },
    ]);

    const rows = await threads
      .query()
      .withMorphMany("reactions", threadHasReactions, reactions)
      .get();

    expect(rows[0]?.reactions).toHaveLength(1);
  });

  test("withMorphOne attaches the first reaction on parent query", async () => {
    const connection = new FakeConnection();
    const reactions = new ReactionRepository(connection);
    const relation = morphOne<Thread, Reaction, "id", "reactable_type", "reactable_id">({
      name: "featured_reaction",
      localKey: "id",
      morphTypeKey: "reactable_type",
      morphIdKey: "reactable_id",
      morphType: "forum_thread",
    });

    const threadTable = defineTable<Thread, "id">({
      name: "forum_threads",
      primaryKey: "id",
      columns: ["id", "title"],
    });

    class ThreadRepository extends BaseRepository<Thread, "id"> {
      constructor(conn: DatabaseConnection) {
        super(threadTable, conn);
      }
    }

    const threads = new ThreadRepository(connection);

    connection.queue([{ id: 1, title: "Thread" }]);
    connection.queue([
      { id: 10, user_id: 1, reactable_type: "forum_thread", reactable_id: 1, kind: "like" },
      { id: 11, user_id: 2, reactable_type: "forum_thread", reactable_id: 1, kind: "like" },
    ]);

    const rows = await threads.query().withMorphOne("featured_reaction", relation, reactions).get();

    expect(rows[0]?.featured_reaction).toEqual({
      id: 10,
      user_id: 1,
      reactable_type: "forum_thread",
      reactable_id: 1,
      kind: "like",
    });
  });

  test("withMorphTo attaches polymorphic parent", async () => {
    const connection = new FakeConnection();
    const reactions = new ReactionRepository(connection);

    const threadTable = defineTable<Thread, "id">({
      name: "forum_threads",
      primaryKey: "id",
      columns: ["id", "title"],
    });

    const episodeTable = defineTable<Episode, "id">({
      name: "learn_episodes",
      primaryKey: "id",
      columns: ["id", "title"],
    });

    class ThreadRepository extends BaseRepository<Thread, "id"> {
      constructor(conn: DatabaseConnection) {
        super(threadTable, conn);
      }
    }

    class EpisodeRepository extends BaseRepository<Episode, "id"> {
      constructor(conn: DatabaseConnection) {
        super(episodeTable, conn);
      }
    }

    const threads = new ThreadRepository(connection);
    const episodes = new EpisodeRepository(connection);

    connection.queue([
      { id: 10, user_id: 1, reactable_type: "forum_thread", reactable_id: 1, kind: "like" },
    ]);
    connection.queue([{ id: 1, title: "Thread" }]);

    const rows = await reactions
      .query()
      .withMorphTo(
        "reactable",
        reactionMorphTo,
        new Map<string, BaseRepository<Thread | Episode, "id">>([
          ["forum_thread", threads],
          ["learn_episode", episodes],
        ]),
      )
      .get();

    expect(rows[0]?.reactable).toEqual({ id: 1, title: "Thread" });
  });
});
