import { describe, expect, test } from "bun:test";
import { valueService } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import {
  type BoundModel,
  defineModel,
  defineRepository,
  type ModelObserver,
} from "@getstrata/core/database/definitions";
import { Model } from "@getstrata/core/database/model";
import { loadNested } from "@getstrata/core/database/modelQuery";
import { defineTable } from "@getstrata/core/database/table";
import { withBoundDatabase } from "../../helpers/boundRepositoryHarness";

type Ticket = {
  id: number;
  title: string;
  status: string | null;
  queue_id: number;
};

const ticketTable = defineTable<Ticket, "id">({
  name: "tickets",
  primaryKey: "id",
  columns: ["id", "title", "status", "queue_id"],
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

class TicketEntity extends Model<Ticket, "id"> {}
const repository = defineRepository({
  name: "tickets",
  table: ticketTable,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
async function withTicket(
  connection: FakeConnection,
  observer: ModelObserver<TicketEntity>,
  work: (model: BoundModel<Ticket, "id", TicketEntity>) => Promise<void>,
) {
  const Observer = createServiceToken<ModelObserver<TicketEntity>>("ticket-observer");
  const definition = defineModel({
    name: "Ticket",
    repository,
    dependencies: [],
    attributes: { fillable: ["title", "status", "queue_id"] },
    observers: [Observer],
    construct: (state, binding) => new TicketEntity(state, binding),
  });
  await withBoundDatabase(
    {
      definition: {
        default: "main",
        connections: { main: { driver: "sqlite", filename: ":memory:" } },
        repositories: [repository],
        models: [definition],
      },
      connection,
      services: [valueService(Observer, observer)],
    },
    (db) => work(db.model(definition)),
  );
}

describe("ModelQuery reaches the RepositoryQuery surface", () => {
  test("whereNotNull is available on a model chain", async () => {
    const connection = new FakeConnection();
    await withTicket(connection, {}, async (TicketModel) => {
      connection.queue([]);

      await (async () => {
        await TicketModel.query().whereNotNull("status").get();
      })();

      expect(connection.calls[0]?.query).toContain("IS NOT NULL");
    });
  });

  test("whereNotIn is available on a model chain", async () => {
    const connection = new FakeConnection();
    await withTicket(connection, {}, async (TicketModel) => {
      connection.queue([]);

      await (async () => {
        await TicketModel.query().whereNotIn("status", ["closed"]).get();
      })();

      expect(connection.calls[0]?.query).toContain("NOT IN");
      expect(connection.calls[0]?.params).toEqual(["closed"]);
    });
  });

  test("join and leftJoin are available on a model chain", async () => {
    const connection = new FakeConnection();
    await withTicket(connection, {}, async (TicketModel) => {
      connection.queue([]);
      connection.queue([]);

      await (async () => {
        await TicketModel.query().join("tickets.queue_id", "queues.id").get();
        await TicketModel.query().leftJoin("tickets.queue_id", "queues.id").get();
      })();

      expect(connection.calls[0]?.query).toContain("INNER JOIN");
      expect(connection.calls[1]?.query).toContain("LEFT JOIN");
    });
  });

  test("groupBy and having are available on a model chain", async () => {
    const connection = new FakeConnection();
    await withTicket(connection, {}, async (TicketModel) => {
      connection.queue([]);

      await (async () => {
        await TicketModel.query().groupBy("status").having({ status: "open" }).get();
      })();

      expect(connection.calls[0]?.query).toContain("GROUP BY");
      expect(connection.calls[0]?.query).toContain("HAVING");
    });
  });

  test("paginate returns hydrated models and pagination meta", async () => {
    const connection = new FakeConnection();
    await withTicket(connection, {}, async (TicketModel) => {
      connection.queue([{ count: "1" }]);
      connection.queue([{ id: 1, title: "First", status: "open", queue_id: 2 }]);

      const page = await TicketModel.query().paginate({ page: 1, perPage: 10 });

      expect(page.data).toHaveLength(1);
      expect(page.data[0]).toBeInstanceOf(Model);
      expect(page.data[0]?.toObject().title).toBe("First");
      expect(page.meta.total).toBe(1);
    });
  });

  test("paginate runs retrieved observers like get does", async () => {
    const connection = new FakeConnection();
    const retrieved: number[] = [];
    await withTicket(
      connection,
      {
        retrieved: () => {
          retrieved.push(1);
        },
      },
      async (TicketModel) => {
        connection.queue([{ count: "1" }]);
        connection.queue([{ id: 1, title: "First", status: "open", queue_id: 2 }]);

        await TicketModel.query().paginate({ page: 1, perPage: 10 });

        expect(retrieved).toEqual([1]);
      },
    );
  });
});

test("a custom relation count refuses malformed SQL before touching the database", async () => {
  const connection = new FakeConnection();
  class BrokenRelation extends Model<Ticket, "id"> {
    malformed() {
      return { toExistsClause: () => ({ sql: "DELETE FROM tickets", params: [] }) };
    }
  }
  const definition = defineModel({
    name: "BrokenRelation",
    repository,
    dependencies: [],
    attributes: {},
    construct: (state, binding) => new BrokenRelation(state, binding),
  });
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
    async (db) => {
      expect(() => db.model(definition).query().withCount("malformed")).toThrow(
        "unexpected subquery shape",
      );
      expect(connection.calls).toEqual([]);
    },
  );
});

test("empty nested-load names leave the existing model untouched without querying", async () => {
  let effects = 0;
  const unexpected = () => {
    effects++;
    throw new Error("No effect expected");
  };
  const model = {
    constructor: {},
    loaded: unexpected,
    getRepository: unexpected,
    toObject: unexpected,
    setLoaded: unexpected,
    load: async () => unexpected(),
  };
  await expect(loadNested(model, "")).resolves.toBeUndefined();
  expect(effects).toBe(0);
});
