import { describe, expect, test } from "bun:test";
import { BaseRepository, type DatabaseConnection } from "@getstrata/core/database/baseRepository";
import { runWithSqlDialect } from "@getstrata/core/database/dialect";
import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";

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

function makeModel(): { TicketModel: typeof Model<Ticket, "id">; connection: FakeConnection } {
  const connection = new FakeConnection();

  class TicketModel extends Model<Ticket, "id"> {
    static override $fillable = ["title", "status", "queue_id"];
  }

  registerModelRepository(
    TicketModel,
    new (class extends BaseRepository<Ticket, "id"> {
      constructor() {
        super(ticketTable, connection);
      }
    })(),
  );

  return { TicketModel: TicketModel as unknown as typeof Model<Ticket, "id">, connection };
}

describe("ModelQuery reaches the RepositoryQuery surface", () => {
  test("whereNotNull is available on a model chain", async () => {
    const { TicketModel, connection } = makeModel();
    connection.queue([]);

    await runWithSqlDialect("pgsql", async () => {
      await TicketModel.query().whereNotNull("status").get();
    });

    expect(connection.calls[0]?.query).toContain("IS NOT NULL");
  });

  test("whereNotIn is available on a model chain", async () => {
    const { TicketModel, connection } = makeModel();
    connection.queue([]);

    await runWithSqlDialect("pgsql", async () => {
      await TicketModel.query().whereNotIn("status", ["closed"]).get();
    });

    expect(connection.calls[0]?.query).toContain("NOT IN");
    expect(connection.calls[0]?.params).toEqual(["closed"]);
  });

  test("join and leftJoin are available on a model chain", async () => {
    const { TicketModel, connection } = makeModel();
    connection.queue([]);
    connection.queue([]);

    await runWithSqlDialect("pgsql", async () => {
      await TicketModel.query().join("tickets.queue_id", "queues.id").get();
      await TicketModel.query().leftJoin("tickets.queue_id", "queues.id").get();
    });

    expect(connection.calls[0]?.query).toContain("INNER JOIN");
    expect(connection.calls[1]?.query).toContain("LEFT JOIN");
  });

  test("groupBy and having are available on a model chain", async () => {
    const { TicketModel, connection } = makeModel();
    connection.queue([]);

    await runWithSqlDialect("pgsql", async () => {
      await TicketModel.query().groupBy("status").having({ status: "open" }).get();
    });

    expect(connection.calls[0]?.query).toContain("GROUP BY");
    expect(connection.calls[0]?.query).toContain("HAVING");
  });

  test("paginate returns hydrated models and pagination meta", async () => {
    const { TicketModel, connection } = makeModel();
    connection.queue([{ count: "1" }]);
    connection.queue([{ id: 1, title: "First", status: "open", queue_id: 2 }]);

    const page = await runWithSqlDialect("pgsql", async () =>
      TicketModel.query().paginate({ page: 1, perPage: 10 }),
    );

    expect(page.data).toHaveLength(1);
    expect(page.data[0]).toBeInstanceOf(Model);
    expect(page.data[0]?.toObject().title).toBe("First");
    expect(page.meta.total).toBe(1);
  });

  test("paginate runs retrieved observers like get does", async () => {
    const { TicketModel, connection } = makeModel();
    const retrieved: number[] = [];
    TicketModel.observe({
      retrieved: () => {
        retrieved.push(1);
      },
    });

    connection.queue([{ count: "1" }]);
    connection.queue([{ id: 1, title: "First", status: "open", queue_id: 2 }]);

    await runWithSqlDialect("pgsql", async () =>
      TicketModel.query().paginate({ page: 1, perPage: 10 }),
    );

    expect(retrieved).toEqual([1]);
  });
});
