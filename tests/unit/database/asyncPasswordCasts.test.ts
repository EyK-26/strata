import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import {
  bindDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import { runWithSqlDialect } from "@getstrata/core/database/dialect";
import {
  applyCasts,
  dehydrateValue,
  Model,
  registerModelRepository,
} from "@getstrata/core/database/model";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { defineTable } from "@getstrata/core/database/table";
import { runInTransaction } from "@getstrata/core/database/transaction";
import { eventBus, modelEventName } from "@getstrata/core/events";

interface AccountRecord {
  id: number;
  name: string;
  password: string | null;
}
const table = defineTable<AccountRecord, "id">({
  name: "async_password_accounts",
  primaryKey: "id",
  columns: ["id", "name", "password"],
});

describe("awaited password write casts", () => {
  let connection: ReturnType<typeof createSqliteConnection>;
  let repository: BaseRepository<AccountRecord, "id">;
  let Account: typeof Model<AccountRecord, "id">;

  beforeEach(async () => {
    connection = createSqliteConnection(":memory:");
    await connection.unsafe(
      "CREATE TABLE async_password_accounts (id INTEGER PRIMARY KEY, name TEXT, password TEXT)",
    );
    bindDatabaseConnection(connection);
    repository = new BaseRepository(table, connection);
    class AccountModel extends Model<AccountRecord, "id"> {
      static override $timestamps = false;
      static override $fillable = ["name", "password"];
      static override $casts = { password: "hashed" } as const;
    }
    Account = registerModelRepository(AccountModel, repository);
  });
  afterEach(() => {
    resetBoundDatabaseConnection();
    connection.close();
  });

  test("create hashes off the event loop and observers receive resolved hashes", async () => {
    const syncHash = spyOn(Bun.password, "hashSync").mockImplementation(() => {
      throw new Error("synchronous hashing forbidden");
    });
    const observations: string[] = [];
    Account.observe({ saving: (model) => observations.push(String(model.get("password"))) });
    let ticks = 0;
    const timer = setInterval(() => {
      ticks++;
    }, 1);
    try {
      const accounts = await runWithSqlDialect("sqlite", () =>
        Promise.all([
          Account.create({ name: "one", password: "password-one" }),
          Account.create({ name: "two", password: "password-two" }),
        ]),
      );
      expect(ticks).toBeGreaterThan(0);
      expect(syncHash).not.toHaveBeenCalled();
      expect(observations).toHaveLength(2);
      expect(observations.every((value) => value.startsWith("$2"))).toBe(true);
      const stored = await connection.unsafe<AccountRecord>(
        "SELECT * FROM async_password_accounts ORDER BY id",
      );
      expect(stored).toHaveLength(2);
      for (const account of accounts) {
        const password = account.get("password");
        expect(typeof password).toBe("string");
        expect(
          await Bun.password.verify(`password-${account.get("name")}`, password as string),
        ).toBe(true);
        expect(stored.find((row) => row.name === account.get("name"))?.password).toBe(password);
      }
    } finally {
      clearInterval(timer);
      syncHash.mockRestore();
    }
  });

  test("an unresolved hash cannot reach observers or SQL", async () => {
    let finish!: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const hash = spyOn(Bun.password, "hash").mockReturnValue(pending);
    const observed: unknown[] = [];
    Account.observe({
      creating: (model) => {
        observed.push(model.get("password"));
      },
    });
    const creation = runWithSqlDialect("sqlite", () =>
      Account.create({ name: "one", password: "plain" }),
    );
    try {
      expect(await connection.unsafe("SELECT * FROM async_password_accounts")).toEqual([]);
      expect(observed).toEqual([]);
      finish("$2b$12$resolved");
      const account = await creation;
      expect(account.get("password")).toBe("$2b$12$resolved");
      expect(observed).toEqual(["$2b$12$resolved"]);
    } finally {
      finish("$2b$12$resolved");
      try {
        await creation;
      } finally {
        hash.mockRestore();
      }
    }
  });

  test("new save, existing save and update await hashing before SQL", async () => {
    await runWithSqlDialect("sqlite", async () => {
      const account = new Account({ id: 1, name: "one", password: "initial" }, repository, false);
      await account.save();
      expect(account.$exists).toBe(true);
      expect(await Bun.password.verify("initial", account.get("password") as string)).toBe(true);
      account.mergeAttributes({ password: "replacement" });
      await account.save();
      expect(await Bun.password.verify("replacement", account.get("password") as string)).toBe(
        true,
      );
      await account.update({ password: "updated" });
      const stored = await Account.findOrFail(account.id);
      expect(stored.get("password")).toBe(account.get("password"));
      expect(await Bun.password.verify("updated", stored.get("password") as string)).toBe(true);
    });
  });

  test("hydration, merge and re-saving existing bcrypt/argon2 hashes never hash", async () => {
    const bcrypt = await Bun.password.hash("original", { algorithm: "bcrypt", cost: 4 });
    const argon = await Bun.password.hash("original", { algorithm: "argon2id" });
    const hash = spyOn(Bun.password, "hash").mockRejectedValue(new Error("unexpected hash"));
    const syncHash = spyOn(Bun.password, "hashSync").mockImplementation(() => {
      throw new Error("unexpected sync hash");
    });
    try {
      const hydrated = new Account(
        { id: 1, name: "one", password: "legacy-plaintext" },
        repository,
      );
      hydrated.mergeAttributes({ password: "another-plaintext" });
      expect(hydrated.get("password")).toBe("another-plaintext");
      for (const password of [bcrypt, argon, null]) {
        await runWithSqlDialect("sqlite", async () => {
          const account = await Account.create({ name: "one", password });
          await account.save();
          expect((await Account.findOrFail(account.id)).get("password")).toBe(password);
        });
      }
      expect(await dehydrateValue(undefined, "hashed")).toBeUndefined();
      expect(hash).not.toHaveBeenCalled();
      expect(syncHash).not.toHaveBeenCalled();
    } finally {
      hash.mockRestore();
      syncHash.mockRestore();
    }
  });

  test("write casts snapshot inputs and hydration remains synchronous", async () => {
    const input = { password: "original", meta: { value: 1 }, count: "2" };
    const pending = applyCasts(
      input,
      { password: "hashed", meta: "json", count: "int" },
      "dehydrate",
    );
    expect(pending).toBeInstanceOf(Promise);
    input.password = "mutated";
    const result = await pending;
    expect(await Bun.password.verify("original", result.password as string)).toBe(true);
    expect(result.meta).toBe('{"value":1}');
    expect(result.count).toBe(2);
    const hydrated = applyCasts(
      { password: "plain", count: "2" },
      { password: "hashed", count: "int" },
      "hydrate",
    );
    expect(hydrated).not.toBeInstanceOf(Promise);
    expect(hydrated).toEqual({ password: "plain", count: 2 });
  });

  test("hash rejection prevents SQL for every model write entry point", async () => {
    await connection.unsafe("INSERT INTO async_password_accounts VALUES (1, 'before', 'stored')");
    const hash = spyOn(Bun.password, "hash").mockRejectedValue(new Error("hash failed"));
    try {
      await runWithSqlDialect("sqlite", async () => {
        await expect(Account.create({ name: "new", password: "plain" })).rejects.toThrow(
          "hash failed",
        );
        const pending = new Account({ id: 2, name: "new", password: "plain" }, repository, false);
        await expect(pending.save()).rejects.toThrow("hash failed");
        expect(pending.$exists).toBe(false);
        const existing = new Account({ id: 1, name: "changed", password: "plain" }, repository);
        await expect(existing.save()).rejects.toThrow("hash failed");
        await expect(existing.update({ password: "different" })).rejects.toThrow("hash failed");
      });
      expect(await connection.unsafe("SELECT * FROM async_password_accounts")).toEqual([
        { id: 1, name: "before", password: "stored" },
      ]);
    } finally {
      hash.mockRestore();
    }
  });

  test("hash failure rolls back earlier writes and their deferred events", async () => {
    const delivered: unknown[] = [];
    const stop = eventBus.listen(modelEventName(table.name, "created"), (value) => {
      delivered.push(value);
    });
    const hash = spyOn(Bun.password, "hash").mockRejectedValue(new Error("hash failed"));
    try {
      await runWithSqlDialect("sqlite", async () => {
        await expect(
          runInTransaction(async () => {
            await Account.create({ name: "before", password: "$2b$12$existing" });
            await Account.create({ name: "failed", password: "plain" });
          }),
        ).rejects.toThrow("hash failed");
      });
      expect(await connection.unsafe("SELECT * FROM async_password_accounts")).toEqual([]);
      expect(delivered).toEqual([]);
    } finally {
      stop();
      hash.mockRestore();
    }
  });

  test("observer failure after hashing rolls back the write and event", async () => {
    const delivered: unknown[] = [];
    const stop = eventBus.listen(modelEventName(table.name, "created"), (value) => {
      delivered.push(value);
    });
    Account.observe({
      saved: () => {
        throw new Error("observer failed");
      },
    });
    try {
      await runWithSqlDialect("sqlite", async () => {
        await expect(
          runInTransaction(async () => {
            await Account.create({ name: "one", password: "plain" });
          }),
        ).rejects.toThrow("observer failed");
      });
      expect(await connection.unsafe("SELECT * FROM async_password_accounts")).toEqual([]);
      expect(delivered).toEqual([]);
    } finally {
      stop();
    }
  });

  test("instance observer failure rolls back a hashed update", async () => {
    const original = await Bun.password.hash("original", { algorithm: "bcrypt", cost: 4 });
    await connection.unsafe("INSERT INTO async_password_accounts VALUES (1, 'before', ?)", [
      original,
    ]);
    Account.observe({
      saved: () => {
        throw new Error("observer failed");
      },
    });
    await runWithSqlDialect("sqlite", async () => {
      await expect(
        runInTransaction(async () => {
          const account = await Account.findOrFail(1);
          await account.update({ name: "after", password: "replacement" });
        }),
      ).rejects.toThrow("observer failed");
    });
    expect(await connection.unsafe("SELECT * FROM async_password_accounts")).toEqual([
      { id: 1, name: "before", password: original },
    ]);
  });

  test("cancelled instance observers prevent hashing and persistence", async () => {
    const hash = spyOn(Bun.password, "hash").mockRejectedValue(new Error("unexpected hash"));
    Account.observe({ saving: () => false });
    try {
      const account = new Account({ id: 1, name: "one", password: "plain" }, repository, false);
      expect(await account.save()).toBe(account);
      expect(account.$exists).toBe(false);
      expect(hash).not.toHaveBeenCalled();
      expect(await connection.unsafe("SELECT * FROM async_password_accounts")).toEqual([]);
    } finally {
      hash.mockRestore();
    }
  });
});
