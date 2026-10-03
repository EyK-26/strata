import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { createHttpKernel } from "@getstrata/bootstrap/httpKernel";
import { AuthManager, GuestGuard } from "@getstrata/core/auth/guard";
import type { DatabaseConnection } from "@getstrata/core/database/baseRepository";
import {
  bindDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import { repositoryConnection } from "@getstrata/core/database/repositoryConnection";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { runInTransaction } from "@getstrata/core/database/transaction";
import { dispatchModelEvent, eventBus } from "@getstrata/core/events";
import { withErrorHandling, withJsonErrorHandling } from "@getstrata/core/http/response";
import { restoreEnvVar } from "../helpers/restoreEnv";
import { createMockDependencies } from "./testHelpers";

describe("transaction composition", () => {
  let connection: ReturnType<typeof createSqliteConnection>;
  let previousMode: string | undefined;

  beforeEach(async () => {
    previousMode = process.env.FRONTEND_MODE;
    process.env.FRONTEND_MODE = "hybrid";
    connection = createSqliteConnection(":memory:");
    await connection.unsafe("CREATE TABLE effects (value INTEGER UNIQUE)");
    bindDatabaseConnection({
      unsafe: connection.unsafe.bind(connection),
      async begin<T>(callback: (transaction: DatabaseConnection) => Promise<T>): Promise<T> {
        await connection.unsafe("BEGIN");
        try {
          const result = await callback(connection);
          await connection.unsafe("COMMIT");
          return result;
        } catch (error) {
          await connection.unsafe("ROLLBACK");
          throw error;
        }
      },
    });
  });

  afterEach(() => {
    resetBoundDatabaseConnection();
    connection.close();
    restoreEnvVar("FRONTEND_MODE", previousMode);
  });

  test("implicit repository queries use the transaction rather than the pool", async () => {
    await expect(
      runInTransaction(async () => {
        await repositoryConnection.unsafe("INSERT INTO effects VALUES (1)");
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await connection.unsafe("SELECT * FROM effects")).toEqual([]);
  });

  test("a caught nested failure rolls back its writes and events only", async () => {
    const seen: unknown[] = [];
    const unsubscribe = eventBus.listen("composition.created", (payload) => {
      seen.push(payload);
    });
    try {
      await runInTransaction(async () => {
        await repositoryConnection.unsafe("INSERT INTO effects VALUES (1)");
        await expect(
          runInTransaction(async () => {
            await repositoryConnection.unsafe("INSERT INTO effects VALUES (2)");
            await dispatchModelEvent("composition.created", 2);
            throw new Error("observer failed");
          }),
        ).rejects.toThrow("observer failed");
        await runInTransaction(async () => {
          await repositoryConnection.unsafe("INSERT INTO effects VALUES (3)");
          await dispatchModelEvent("composition.created", 3);
        });
        expect(seen).toEqual([]);
      });
      expect(await connection.unsafe("SELECT value FROM effects ORDER BY value")).toEqual([
        { value: 1 },
        { value: 3 },
      ]);
      expect(seen).toEqual([3]);
    } finally {
      unsubscribe();
    }
  });

  test("outer rollback discards successful savepoint writes and events", async () => {
    const seen: unknown[] = [];
    const unsubscribe = eventBus.listen("composition.created", (payload) => {
      seen.push(payload);
    });
    try {
      await expect(
        runInTransaction(async () => {
          await runInTransaction(async () => {
            await repositoryConnection.unsafe("INSERT INTO effects VALUES (1)");
            await dispatchModelEvent("composition.created", 1);
          });
          throw new Error("outer failure");
        }),
      ).rejects.toThrow("outer failure");
      expect(await connection.unsafe("SELECT * FROM effects")).toEqual([]);
      expect(seen).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  test("a nested SQL error leaves the outer transaction usable", async () => {
    await runInTransaction(async () => {
      await repositoryConnection.unsafe("INSERT INTO effects VALUES (1)");
      await expect(
        runInTransaction(async () => {
          await repositoryConnection.unsafe("INSERT INTO effects VALUES (2)");
          await repositoryConnection.unsafe("INSERT INTO effects VALUES (1)");
        }),
      ).rejects.toThrow();
      await repositoryConnection.unsafe("INSERT INTO effects VALUES (3)");
    });
    expect(await connection.unsafe("SELECT value FROM effects ORDER BY value")).toEqual([
      { value: 1 },
      { value: 3 },
    ]);
  });

  test("rejects concurrent sibling savepoints without corrupting the first", async () => {
    await runInTransaction(async () => {
      let unblock!: () => void;
      const blocked = new Promise<void>((resolve) => {
        unblock = resolve;
      });
      const first = runInTransaction(async () => {
        await blocked;
        await repositoryConnection.unsafe("INSERT INTO effects VALUES (1)");
      });
      try {
        await expect(runInTransaction(async () => undefined)).rejects.toThrow(
          "Concurrent nested transactions",
        );
      } finally {
        unblock();
        await first;
      }
    });
    expect(await connection.unsafe("SELECT * FROM effects")).toEqual([{ value: 1 }]);
  });

  for (const format of ["json", "html"] as const) {
    test(`real HTTP ${format} errors cannot commit a failed business transaction`, async () => {
      const container = new ServiceContainer();
      container.set(CORE_AUTH_TOKEN, new AuthManager(new GuestGuard()));
      const kernel = createHttpKernel(createMockDependencies(container));
      const business = async () =>
        runInTransaction(async () => {
          await repositoryConnection.unsafe("INSERT INTO effects VALUES (1)");
          throw new Error("observer failed after write");
        });
      const handler =
        format === "json"
          ? kernel.wrap("api", withJsonErrorHandling(business))
          : kernel.wrap("web", withErrorHandling(business));
      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: (request) => runInTransaction(async () => handler(request)),
      });
      try {
        const response = await fetch(`http://127.0.0.1:${server.port}/failure`, {
          headers: { accept: format === "json" ? "application/json" : "text/html" },
        });
        expect(response.status).toBe(500);
        expect(response.headers.get("content-type")).toContain(
          format === "json" ? "application/json" : "text/html",
        );
        await response.text();
        expect(await connection.unsafe("SELECT * FROM effects")).toEqual([]);
      } finally {
        await server.stop(true);
      }
    });
  }

  test("an intentionally returned 4xx does not imply rollback", async () => {
    const response = await runInTransaction(async () => {
      await repositoryConnection.unsafe("INSERT INTO effects VALUES (1)");
      return new Response("intentional", { status: 409 });
    });
    expect(response.status).toBe(409);
    expect(await connection.unsafe("SELECT * FROM effects")).toEqual([{ value: 1 }]);
  });
});
