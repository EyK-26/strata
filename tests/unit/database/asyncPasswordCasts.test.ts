import { describe, expect, spyOn, test } from "bun:test";
import { valueService } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import {
  type AfterCommitRepositoryListener,
  type BoundModel,
  defineModel,
  defineRepository,
  type ModelObserver,
} from "@getstrata/core/database/definitions";
import { applyCasts, dehydrateValue, Model } from "@getstrata/core/database/model";
import type { DatabaseSession } from "@getstrata/core/database/session";
import { defineTable } from "@getstrata/core/database/table";
import { withBoundDatabase } from "../../helpers/boundRepositoryHarness";

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

class AccountEntity extends Model<AccountRecord, "id"> {}
interface MultiHashRecord extends AccountRecord {
  pin: string;
}
class MultiEntity extends Model<MultiHashRecord, "id"> {}
const Observer = createServiceToken<ModelObserver<AccountEntity>>("account-observer");
const MultiObserver = createServiceToken<ModelObserver<MultiEntity>>("multi-observer");
const Created = createServiceToken<AfterCommitRepositoryListener<AccountRecord>>("created-account");
const accounts = defineRepository({
  name: "accounts",
  table,
  dependencies: [],
  effects: [{ action: "created", afterCommit: Created }],
  create: (binding) => new BaseRepository(binding),
});
const multiTable = defineTable<MultiHashRecord, "id">({
  ...table,
  columns: [...table.columns, "pin"],
});
const multiAccounts = defineRepository({
  name: "multi-accounts",
  table: multiTable,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const AccountDefinition = defineModel({
  name: "Account",
  repository: accounts,
  dependencies: [],
  attributes: { timestamps: false, fillable: ["name", "password"], casts: { password: "hashed" } },
  observers: [Observer],
  construct: (state, binding) => new AccountEntity(state, binding),
});
const MultiDefinition = defineModel({
  name: "MultiHashAccount",
  repository: multiAccounts,
  dependencies: [],
  attributes: {
    timestamps: false,
    fillable: ["name", "password", "pin"],
    casts: { password: "hashed", pin: "hashed" },
  },
  observers: [MultiObserver],
  construct: (state, binding) => new MultiEntity(state, binding),
});
async function fixture(
  work: (context: {
    Account: BoundModel<AccountRecord, "id", AccountEntity>;
    Accounts: BoundModel<MultiHashRecord, "id", MultiEntity>;
    db: DatabaseSession;
    query: <R = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ) => Promise<readonly R[]>;
    delivered: unknown[];
  }) => Promise<void>,
  options: {
    observer?: ModelObserver<AccountEntity>;
    multiObserver?: ModelObserver<MultiEntity>;
  } = {},
) {
  const delivered: unknown[] = [];
  await withBoundDatabase(
    {
      definition: {
        default: "main",
        connections: { main: { driver: "sqlite", filename: ":memory:" } },
        repositories: [accounts, multiAccounts],
        models: [AccountDefinition, MultiDefinition],
      },
      services: [
        valueService(Observer, options.observer ?? {}),
        valueService(MultiObserver, options.multiObserver ?? {}),
        valueService(Created, (row) => {
          delivered.push(row);
        }),
      ],
    },
    async (db) => {
      await db.execute({
        text: "CREATE TABLE async_password_accounts (id INTEGER PRIMARY KEY, name TEXT, password TEXT)",
        params: [],
      });
      await work({
        Account: db.model(AccountDefinition),
        Accounts: db.model(MultiDefinition),
        db,
        query: (text, params = []) => db.execute({ text, params }),
        delivered,
      });
    },
  );
}

describe("awaited password write casts", () => {
  test("create hashes off the event loop and observers receive resolved hashes", async () => {
    const observations: string[] = [];
    await fixture(
      async ({ Account, query }) => {
        const syncHash = spyOn(Bun.password, "hashSync").mockImplementation(() => {
          throw new Error("synchronous hashing forbidden");
        });
        let ticks = 0;
        const timer = setInterval(() => {
          ticks++;
        }, 1);
        try {
          const accounts = await Promise.all([
            Account.create({ name: "one", password: "password-one" }),
            Account.create({ name: "two", password: "password-two" }),
          ]);
          expect(ticks).toBeGreaterThan(0);
          expect(syncHash).not.toHaveBeenCalled();
          expect(observations).toHaveLength(2);
          expect(observations.every((value) => value.startsWith("$2"))).toBe(true);
          const stored = await query<AccountRecord>(
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
      },
      { observer: { saving: (model) => observations.push(String(model.get("password"))) } },
    );
  });

  test("an unresolved hash cannot reach observers or SQL", async () => {
    const observed: unknown[] = [];
    await fixture(
      async ({ Account, query }) => {
        let finish!: (value: string) => void;
        const pending = new Promise<string>((resolve) => {
          finish = resolve;
        });
        const hash = spyOn(Bun.password, "hash").mockReturnValue(pending);
        const creation = Account.create({ name: "one", password: "plain" });
        try {
          expect(await query("SELECT * FROM async_password_accounts")).toEqual([]);
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
      },
      {
        observer: {
          creating: (model) => {
            observed.push(model.get("password"));
          },
        },
      },
    );
  });

  test("new save, existing save and update await hashing before SQL", async () => {
    await fixture(async ({ Account }) => {
      await (async () => {
        const account = Account.newRecord({ id: 1, name: "one", password: "initial" });
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
      })();
    }, {});
  });

  test("hydration, merge and re-saving existing bcrypt/argon2 hashes never hash", async () => {
    await fixture(async ({ Account }) => {
      const bcrypt = await Bun.password.hash("original", { algorithm: "bcrypt", cost: 4 });
      const argon = await Bun.password.hash("original", { algorithm: "argon2id" });
      const hash = spyOn(Bun.password, "hash").mockRejectedValue(new Error("unexpected hash"));
      const syncHash = spyOn(Bun.password, "hashSync").mockImplementation(() => {
        throw new Error("unexpected sync hash");
      });
      try {
        const hydrated = Account.hydrate({ id: 1, name: "one", password: "legacy-plaintext" });
        hydrated.mergeAttributes({ password: "another-plaintext" });
        expect(hydrated.get("password")).toBe("another-plaintext");
        for (const password of [bcrypt, argon, null]) {
          await (async () => {
            const account = await Account.create({ name: "one", password });
            await account.save();
            expect((await Account.findOrFail(account.id)).get("password")).toBe(password);
          })();
        }
        expect(await dehydrateValue(undefined, "hashed")).toBeUndefined();
        expect(hash).not.toHaveBeenCalled();
        expect(syncHash).not.toHaveBeenCalled();
      } finally {
        hash.mockRestore();
        syncHash.mockRestore();
      }
    }, {});
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
    await fixture(async ({ Account, query }) => {
      await query("INSERT INTO async_password_accounts VALUES (1, 'before', 'stored')");
      const hash = spyOn(Bun.password, "hash").mockRejectedValue(new Error("hash failed"));
      try {
        await (async () => {
          await expect(Account.create({ name: "new", password: "plain" })).rejects.toThrow(
            "hash failed",
          );
          const pending = Account.newRecord({ id: 2, name: "new", password: "plain" });
          await expect(pending.save()).rejects.toThrow("hash failed");
          expect(pending.$exists).toBe(false);
          const existing = Account.hydrate({ id: 1, name: "changed", password: "plain" });
          existing.mergeAttributes({ password: "replacement" });
          await expect(existing.save()).rejects.toThrow("hash failed");
          await expect(existing.update({ password: "different" })).rejects.toThrow("hash failed");
        })();
        expect(await query("SELECT * FROM async_password_accounts")).toEqual([
          { id: 1, name: "before", password: "stored" },
        ]);
      } finally {
        hash.mockRestore();
      }
    }, {});
  });

  test("a rejected concurrent cast never reaches model observers or SQL", async () => {
    const observed: string[] = [];
    await fixture(
      async ({ Accounts, query }) => {
        await query("ALTER TABLE async_password_accounts ADD COLUMN pin TEXT");
        let finish!: (value: string) => void;
        const firstHash = new Promise<string>((resolve) => {
          finish = resolve;
        });
        const hash = spyOn(Bun.password, "hash")
          .mockReturnValueOnce(firstHash)
          .mockRejectedValueOnce(new Error("second hash failed"));
        const creation = Promise.resolve(
          Accounts.create({ name: "new", password: "plain", pin: "pin" }),
        );
        try {
          await expect(creation).rejects.toThrow("second hash failed");
          expect(hash).toHaveBeenCalledTimes(2);
          expect(observed).toEqual([]);
          expect(await query("SELECT * FROM async_password_accounts")).toEqual([]);
          finish("$2b$12$resolved");
          await firstHash;
          await expect(creation).rejects.toThrow("second hash failed");
          expect(observed).toEqual([]);
          expect(await query("SELECT * FROM async_password_accounts")).toEqual([]);
        } finally {
          finish("$2b$12$resolved");
          await creation.catch(() => {});
          hash.mockRestore();
        }
      },
      {
        multiObserver: {
          creating: () => {
            observed.push("creating");
          },
          saving: () => {
            observed.push("saving");
          },
        },
      },
    );
  });

  test("hash failure rolls back earlier writes and their deferred events", async () => {
    await fixture(async ({ db, query, delivered }) => {
      const hash = spyOn(Bun.password, "hash").mockRejectedValue(new Error("hash failed"));
      try {
        await (async () => {
          await expect(
            db.transaction(async (tx) => {
              const Account = tx.model(AccountDefinition);
              await Account.create({ name: "before", password: "$2b$12$existing" });
              await Account.create({ name: "failed", password: "plain" });
            }),
          ).rejects.toThrow("hash failed");
        })();
        expect(await query("SELECT * FROM async_password_accounts")).toEqual([]);
        expect(delivered).toEqual([]);
      } finally {
        hash.mockRestore();
      }
    }, {});
  });

  test("observer failure after hashing rolls back the write and event", async () => {
    await fixture(
      async ({ db, query, delivered }) => {
        await (async () => {
          await expect(
            db.transaction(async (tx) => {
              const Account = tx.model(AccountDefinition);
              await Account.create({ name: "one", password: "plain" });
            }),
          ).rejects.toThrow("observer failed");
        })();
        expect(await query("SELECT * FROM async_password_accounts")).toEqual([]);
        expect(delivered).toEqual([]);
      },
      {
        observer: {
          saved: () => {
            throw new Error("observer failed");
          },
        },
      },
    );
  });

  test("instance observer failure rolls back a hashed update", async () => {
    await fixture(
      async ({ db, query }) => {
        const original = await Bun.password.hash("original", { algorithm: "bcrypt", cost: 4 });
        await query("INSERT INTO async_password_accounts VALUES (1, 'before', ?)", [original]);
        await (async () => {
          await expect(
            db.transaction(async (tx) => {
              const Account = tx.model(AccountDefinition);
              const account = await Account.findOrFail(1);
              await account.update({ name: "after", password: "replacement" });
            }),
          ).rejects.toThrow("observer failed");
        })();
        expect(await query("SELECT * FROM async_password_accounts")).toEqual([
          { id: 1, name: "before", password: original },
        ]);
      },
      {
        observer: {
          saved: () => {
            throw new Error("observer failed");
          },
        },
      },
    );
  });

  test("cancelled instance observers prevent hashing and persistence", async () => {
    await fixture(
      async ({ Account, query }) => {
        const hash = spyOn(Bun.password, "hash").mockRejectedValue(new Error("unexpected hash"));
        try {
          const account = Account.newRecord({ id: 1, name: "one", password: "plain" });
          expect(await account.save()).toBe(account);
          expect(account.$exists).toBe(false);
          expect(hash).not.toHaveBeenCalled();
          expect(await query("SELECT * FROM async_password_accounts")).toEqual([]);
        } finally {
          hash.mockRestore();
        }
      },
      { observer: { saving: () => false } },
    );
  });
});
