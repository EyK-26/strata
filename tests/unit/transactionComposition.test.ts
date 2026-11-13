import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { createHttpKernel } from "@getstrata/bootstrap/httpKernel";
import { AuthManager, GuestGuard } from "@getstrata/core/auth/guard";
import { valueService } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import {
  type AfterCommitRepositoryListener,
  defineRepository,
} from "@getstrata/core/database/definitions";
import type { DatabaseSession } from "@getstrata/core/database/session";
import { type DatabaseInvocation, withBoundDatabase } from "../helpers/boundRepositoryHarness";
import { restoreEnvVar } from "../helpers/restoreEnv";
import { createMockDependencies } from "./testHelpers";

const listener =
  createServiceToken<AfterCommitRepositoryListener<{ value: number }>>("composition.created");
const definition = defineRepository({
  name: "Effects",
  table: { name: "effects", primaryKey: "value", columns: ["value"] },
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
  effects: [{ action: "created", afterCommit: listener }],
});
const sql = (db: Pick<DatabaseSession, "execute">, text: string) =>
  db.execute<{ value: number }>({ text, params: [] });
async function fixture(
  work: (database: DatabaseSession, invoke: DatabaseInvocation, seen: unknown[]) => Promise<void>,
) {
  const seen: unknown[] = [];
  await withBoundDatabase(
    {
      definition: {
        default: "main",
        connections: { main: { driver: "sqlite", filename: ":memory:" } },
        repositories: [definition],
      },
      services: [
        valueService(listener, (row) => {
          seen.push(row.value);
        }),
      ],
    },
    async (database, invoke) => {
      await sql(database, "CREATE TABLE effects(value INTEGER UNIQUE)");
      await work(database, invoke, seen);
    },
  );
}

let previousMode: string | undefined;
beforeEach(() => {
  previousMode = process.env.FRONTEND_MODE;
  process.env.FRONTEND_MODE = "hybrid";
});
afterEach(() => restoreEnvVar("FRONTEND_MODE", previousMode));
describe("transaction composition", () => {
  test("afterCommit waits for the outer commit and discards rolled-back savepoint callbacks", async () =>
    fixture(async (database) => {
      const effects: string[] = [];
      await database.transaction(async (outer) => {
        await sql(outer, "INSERT INTO effects VALUES (1)");
        outer.afterCommit(async () => {
          await database.transaction((child) => sql(child, "INSERT INTO effects VALUES (2)"));
          effects.push("outer");
        });
        await expect(
          outer.transaction(async (child) => {
            child.afterCommit(() => {
              effects.push("rolled back");
            });
            throw new Error("savepoint failure");
          }),
        ).rejects.toThrow("savepoint failure");
        await outer.transaction(async (child) => {
          child.afterCommit(() => {
            effects.push("nested");
          });
        });
        expect(effects).toEqual([]);
      });
      expect(effects).toEqual(["outer", "nested"]);
      expect(await sql(database, "SELECT value FROM effects ORDER BY value")).toEqual([
        { value: 1 },
        { value: 2 },
      ]);
    }));
  test("afterCommit never executes on outer rollback or SQL failure", async () =>
    fixture(async (database) => {
      let count = 0;
      for (const mode of ["outer", "sql"])
        await expect(
          database.transaction(async (outer) => {
            await outer.transaction(async (child) => {
              child.afterCommit(() => {
                count++;
              });
            });
            if (mode === "sql") await sql(outer, "INSERT INTO missing_table VALUES (1)");
            throw new Error(mode);
          }),
        ).rejects.toThrow();
      expect(count).toBe(0);
    }));
  test("afterCommit failure reports an error without reverting committed database effects", async () =>
    fixture(async (database) => {
      await expect(
        database.transaction(async (child) => {
          await sql(child, "INSERT INTO effects VALUES (1)");
          child.afterCommit(() => {
            throw new Error("SMTP unavailable");
          });
        }),
      ).rejects.toMatchObject({ code: "DATABASE_POST_COMMIT_FAILED", data: "committed" });
      expect(await sql(database, "SELECT value FROM effects")).toEqual([{ value: 1 }]);
    }));
  test("explicit repository queries use the transaction rather than the pool", async () =>
    fixture(async (database) => {
      await expect(
        database.transaction(async (child) => {
          await child.repository(definition).create({ value: 1 });
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      expect(await sql(database, "SELECT * FROM effects")).toEqual([]);
    }));
  test("a caught nested failure rolls back its writes and events only", async () =>
    fixture(async (database, _invoke, seen) => {
      await database.transaction(async (outer) => {
        await sql(outer, "INSERT INTO effects VALUES (1)");
        await expect(
          outer.transaction(async (child) => {
            await child.repository(definition).create({ value: 2 });
            throw new Error("observer failed");
          }),
        ).rejects.toThrow("observer failed");
        await outer.transaction((child) => child.repository(definition).create({ value: 3 }));
        expect(seen).toEqual([]);
      });
      expect(await sql(database, "SELECT value FROM effects ORDER BY value")).toEqual([
        { value: 1 },
        { value: 3 },
      ]);
      expect(seen).toEqual([3]);
    }));
  test("outer rollback discards successful savepoint writes and events", async () =>
    fixture(async (database, _invoke, seen) => {
      await expect(
        database.transaction(async (outer) => {
          await outer.transaction((child) => child.repository(definition).create({ value: 1 }));
          throw new Error("outer failure");
        }),
      ).rejects.toThrow("outer failure");
      expect(await sql(database, "SELECT * FROM effects")).toEqual([]);
      expect(seen).toEqual([]);
    }));
  test("a nested SQL error leaves the outer transaction usable", async () =>
    fixture(async (database) => {
      await database.transaction(async (outer) => {
        await sql(outer, "INSERT INTO effects VALUES (1)");
        await expect(
          outer.transaction(async (child) => {
            await sql(child, "INSERT INTO effects VALUES (2)");
            await sql(child, "INSERT INTO effects VALUES (1)");
          }),
        ).rejects.toThrow();
        await sql(outer, "INSERT INTO effects VALUES (3)");
      });
      expect(await sql(database, "SELECT value FROM effects ORDER BY value")).toEqual([
        { value: 1 },
        { value: 3 },
      ]);
    }));
  test("rejects concurrent sibling savepoints without corrupting the first", async () =>
    fixture(async (database) => {
      await database.transaction(async (outer) => {
        let unblock!: () => void;
        const blocked = new Promise<void>((resolve) => {
          unblock = resolve;
        });
        const first = outer.transaction(async (child) => {
          await blocked;
          await sql(child, "INSERT INTO effects VALUES (1)");
        });
        try {
          await expect(outer.transaction(async () => undefined)).rejects.toMatchObject({
            code: "DATABASE_TRANSACTION_SCOPE",
          });
        } finally {
          unblock();
          await first;
        }
      });
      expect(await sql(database, "SELECT * FROM effects")).toEqual([{ value: 1 }]);
    }));
  for (const format of ["json", "html"] as const)
    test(`real HTTP ${format} errors cannot commit a failed business transaction`, async () =>
      fixture(async (database, invoke) => {
        const container = new ServiceContainer();
        container.set(
          CORE_AUTH_TOKEN,
          new AuthManager(
            new GuestGuard({
              production: false,
              allowDevHeaders: false,
              abilities: { admin: [], member: [] },
            }),
          ),
        );
        const kernel = createHttpKernel(
          createMockDependencies(container, undefined, undefined, (envelope, work) =>
            invoke((database, policy) => work({ database, policy }), envelope),
          ),
        );
        const business = async (
          _request: Request,
          ports: import("@getstrata/bootstrap/persistenceContracts").BusinessRequestPorts,
        ) => {
          return ports.database.transaction(async (child) => {
            await sql(child, "INSERT INTO effects VALUES (1)");
            throw new Error("observer failed after write");
          });
        };
        const handler = format === "json" ? kernel.wrap("api", business) : kernel.wrapWeb(business);
        const server = Bun.serve({
          port: 0,
          hostname: "127.0.0.1",
          fetch: (request) => handler(request),
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
          expect(await sql(database, "SELECT * FROM effects")).toEqual([]);
        } finally {
          await server.stop(true);
          kernel.dispose();
        }
      }));
  test("an intentionally returned 4xx does not imply rollback", async () =>
    fixture(async (database) => {
      const response = await database.transaction(async (child) => {
        await sql(child, "INSERT INTO effects VALUES (1)");
        return new Response("intentional", { status: 409 });
      });
      expect(response.status).toBe(409);
      expect(await sql(database, "SELECT * FROM effects")).toEqual([{ value: 1 }]);
    }));
});
