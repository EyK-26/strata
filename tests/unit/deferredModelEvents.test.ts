import { afterEach, describe, expect, test } from "bun:test";
import type { SqlDatabaseConnection } from "@getstrata/core/database/baseRepository";
import { BaseRepository, type DatabaseConnection } from "@getstrata/core/database/baseRepository";
import { bindDatabaseConnection } from "@getstrata/core/database/bindConnection";
import { resetBoundDatabaseConnection } from "@getstrata/core/database/boundConnection";
import {
  getDefaultDatabasePool,
  registerDefaultDatabasePool,
  resetDefaultDatabasePoolForTests,
} from "@getstrata/core/database/defaultConnection";
import { defineTable } from "@getstrata/core/database/table";
import { runInTransaction } from "@getstrata/core/database/transaction";
import { dispatchModelEvent, eventBus, runWithDeferredModelEvents } from "@getstrata/core/events";
import {
  currentTenant,
  runWithTenant,
  type TenantContext,
} from "@getstrata/core/tenant/tenantContext";
import { getDatabase } from "../../src/db/connection";
import { restoreEnvVar } from "../helpers/restoreEnv";
import { defaultTestTenant } from "./testHelpers";

type Item = { id: number; name: string };

const items = defineTable<Item, "id">({
  name: "orders",
  primaryKey: "id",
  columns: ["id", "name"],
});

class FakeConnection implements DatabaseConnection {
  private readonly responses: unknown[][] = [];

  queue(rows: unknown[]): void {
    this.responses.push(rows);
  }

  async unsafe<T>(): Promise<T[]> {
    return (this.responses.shift() ?? []) as T[];
  }
}

class ItemRepository extends BaseRepository<Item, "id"> {
  constructor(connection: DatabaseConnection) {
    super(items, connection);
  }
}

const otherTenant: TenantContext = {
  id: 2,
  slug: "beta",
  plan: "pro",
  region: "us",
};

type TransactionCapableConnection = DatabaseConnection & {
  begin<TValue>(callback: (transaction: DatabaseConnection) => Promise<TValue>): Promise<TValue>;
};

function bindFakeTransactionConnection(): void {
  const transactionConnection: DatabaseConnection = {
    async unsafe() {
      return [];
    },
  };

  bindDatabaseConnection({
    async unsafe() {
      return [];
    },
    async begin(callback) {
      return await callback(transactionConnection);
    },
  } as TransactionCapableConnection);
}

function restorePool(previous: SqlDatabaseConnection | null): void {
  if (previous) {
    registerDefaultDatabasePool(previous);
    return;
  }
  resetDefaultDatabasePoolForTests();
  if (process.env.DATABASE_URL) {
    getDatabase();
  }
}

function currentPoolOrNull(): SqlDatabaseConnection | null {
  try {
    return getDefaultDatabasePool();
  } catch {
    return null;
  }
}

function fakePool(calls: string[]): SqlDatabaseConnection {
  const pool = Object.assign(async () => [] as unknown[], {
    async begin<T>(callback: (tx: typeof pool) => Promise<T>) {
      calls.push("begin");
      return await callback(pool);
    },
    async close() {},
    async unsafe<T>(query: string, params?: readonly unknown[]) {
      calls.push(`${query} ${JSON.stringify(params ?? [])}`);
      return [] as T[];
    },
  });
  return pool as SqlDatabaseConnection;
}

describe("commit-aware model events", () => {
  afterEach(() => {
    resetBoundDatabaseConnection();
  });

  test("dispatches immediately when no transaction is open", async () => {
    const seen: unknown[] = [];
    const unsubscribe = eventBus.listen("orders.created", (payload) => {
      seen.push(payload);
    });

    await dispatchModelEvent("orders.created", { id: 1 });
    unsubscribe();

    expect(seen).toEqual([{ id: 1 }]);
  });

  test("defers listeners until the surrounding transaction callback returns", async () => {
    const order: string[] = [];
    const unsubscribe = eventBus.listen("orders.created", () => {
      order.push("listener");
    });

    await runWithDeferredModelEvents(async () => {
      await dispatchModelEvent("orders.created", { id: 1 });
      order.push("inside");
      expect(order).toEqual(["inside"]);
    });
    unsubscribe();

    expect(order).toEqual(["inside", "listener"]);
  });

  test("discards deferred listeners when the transaction throws", async () => {
    let calls = 0;
    const unsubscribe = eventBus.listen("orders.created", () => {
      calls += 1;
    });

    await expect(
      runWithDeferredModelEvents(async () => {
        await dispatchModelEvent("orders.created", { id: 1 });
        throw new Error("checkout failed");
      }),
    ).rejects.toThrow("checkout failed");
    unsubscribe();

    expect(calls).toBe(0);
  });

  test("does not dispatch when a transaction commits with no model events", async () => {
    await expect(runWithDeferredModelEvents(async () => "ok")).resolves.toBe("ok");
  });

  test("promotes nested transaction events to the outer commit", async () => {
    const seen: number[] = [];
    const unsubscribe = eventBus.listen("orders.created", (payload) => {
      seen.push((payload as { id: number }).id);
    });

    await runWithDeferredModelEvents(async () => {
      await dispatchModelEvent("orders.created", { id: 1 });
      await runWithDeferredModelEvents(async () => {
        await dispatchModelEvent("orders.created", { id: 2 });
        expect(seen).toEqual([]);
      });
      expect(seen).toEqual([]);
    });
    unsubscribe();

    expect(seen).toEqual([1, 2]);
  });

  test("discards nested events when the inner transaction rolls back", async () => {
    const seen: number[] = [];
    const unsubscribe = eventBus.listen("orders.created", (payload) => {
      seen.push((payload as { id: number }).id);
    });

    await runWithDeferredModelEvents(async () => {
      await dispatchModelEvent("orders.created", { id: 1 });
      await expect(
        runWithDeferredModelEvents(async () => {
          await dispatchModelEvent("orders.created", { id: 2 });
          throw new Error("inner");
        }),
      ).rejects.toThrow("inner");
    });
    unsubscribe();

    expect(seen).toEqual([1]);
  });

  test("discards every deferred event when the outer transaction rolls back", async () => {
    let calls = 0;
    const unsubscribe = eventBus.listen("orders.created", () => {
      calls += 1;
    });

    await expect(
      runWithDeferredModelEvents(async () => {
        await dispatchModelEvent("orders.created", { id: 1 });
        await runWithDeferredModelEvents(async () => {
          await dispatchModelEvent("orders.created", { id: 2 });
        });
        throw new Error("outer");
      }),
    ).rejects.toThrow("outer");
    unsubscribe();

    expect(calls).toBe(0);
  });

  test("restores tenant context when deferred listeners run", async () => {
    const previous = process.env.TENANCY_DRIVER;
    process.env.TENANCY_DRIVER = "none";
    const tenants: Array<number | null> = [];
    const unsubscribe = eventBus.listen("orders.created", () => {
      tenants.push(currentTenant()?.id ?? null);
    });

    try {
      await runWithTenant(defaultTestTenant, async () => {
        await runWithDeferredModelEvents(async () => {
          await dispatchModelEvent("orders.created", { id: 1 });
          await dispatchModelEvent("orders.created", { id: 2 });
        });
      });
    } finally {
      unsubscribe();
      restoreEnvVar("TENANCY_DRIVER", previous);
    }

    expect(tenants).toEqual([1, 1]);
    expect(currentTenant()).toBeNull();
  });

  test("restores RLS tenant scope when flushing after commit", async () => {
    const previous = process.env.TENANCY_DRIVER;
    process.env.TENANCY_DRIVER = "rls";
    const restored = currentPoolOrNull();
    const calls: string[] = [];
    registerDefaultDatabasePool(fakePool(calls));
    const tenants: Array<number | null> = [];
    const unsubscribe = eventBus.listen("orders.created", () => {
      tenants.push(currentTenant()?.id ?? null);
    });

    try {
      await runWithTenant(defaultTestTenant, async () => {
        await runWithDeferredModelEvents(async () => {
          await dispatchModelEvent("orders.created", { id: 1 });
        });
      });
    } finally {
      unsubscribe();
      restorePool(restored);
      restoreEnvVar("TENANCY_DRIVER", previous);
    }

    expect(tenants).toEqual([1]);
    expect(calls[0]).toBe("begin");
    expect(calls.some((line) => line.includes("set_config('app.tenant_id'"))).toBe(true);
  });

  test("flushes mixed-tenant events in separate tenant batches", async () => {
    const previous = process.env.TENANCY_DRIVER;
    process.env.TENANCY_DRIVER = "none";
    const tenants: Array<number | null> = [];
    const unsubscribe = eventBus.listen("orders.created", () => {
      tenants.push(currentTenant()?.id ?? null);
    });

    try {
      await runWithDeferredModelEvents(async () => {
        await runWithTenant(defaultTestTenant, async () => {
          await dispatchModelEvent("orders.created", { id: 1 });
        });
        await dispatchModelEvent("orders.created", { id: 2 });
        await runWithTenant(otherTenant, async () => {
          await dispatchModelEvent("orders.created", { id: 3 });
        });
      });
    } finally {
      unsubscribe();
      restoreEnvVar("TENANCY_DRIVER", previous);
    }

    expect(tenants).toEqual([1, null, 2]);
  });

  test("keeps repository create events until runInTransaction commits", async () => {
    bindFakeTransactionConnection();
    const connection = new FakeConnection();
    const repository = new ItemRepository(connection);
    const seen: string[] = [];
    const unsubscribe = eventBus.listen("orders.created", () => {
      seen.push("created");
    });

    connection.queue([{ id: 1, name: "pending" }]);
    connection.queue([{ id: 2, name: "committed" }]);

    try {
      await runInTransaction(async () => {
        await repository.create({ id: 1, name: "pending" });
        expect(seen).toEqual([]);
      });

      await expect(
        runInTransaction(async () => {
          await repository.create({ id: 2, name: "committed" });
          throw new Error("rolled back");
        }),
      ).rejects.toThrow("rolled back");
    } finally {
      unsubscribe();
    }

    expect(seen).toEqual(["created"]);
  });
});
