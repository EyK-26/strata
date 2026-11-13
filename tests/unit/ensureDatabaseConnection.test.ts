import { describe, expect, test } from "bun:test";
import type { DatabaseConnection } from "../../src/db/connection/createConnection";
import { FixtureDatabase } from "../helpers/fixtureDatabase";
import { createMockDatabaseConnection } from "./testHelpers";

describe("private fixture database ownership", () => {
  test("recreates the connection when ping fails and closes the old handle first", async () => {
    const events: string[] = [];
    const failed = createMockDatabaseConnection(
      async () => {
        throw new Error("connection down");
      },
      {
        close: async () => {
          events.push("failed.close");
        },
      },
    );
    const healthy = createMockDatabaseConnection(async () => [{ ok: true }], {
      close: async () => {
        events.push("healthy.close");
      },
    });
    const owner = new FixtureDatabase(() => {
      events.push("create");
      return events.filter((event) => event === "create").length === 1 ? failed : healthy;
    });
    try {
      expect(owner.connection()).toBe(failed);
      expect(await owner.ensure()).toBe(healthy);
      expect(await owner.ping()).toBe(true);
      expect(events).toEqual(["create", "failed.close", "create"]);
    } finally {
      await owner.close();
    }
    expect(events.at(-1)).toBe("healthy.close");
  });

  test("deliberate replacement and close do not acquire or register a public default", async () => {
    let created = 0,
      closed = 0;
    const make = () => {
      created++;
      return createMockDatabaseConnection(async () => [], {
        close: async () => {
          closed++;
        },
      });
    };
    const owner = new FixtureDatabase(make);
    await owner.close();
    expect(created).toBe(0);
    const first = owner.connection();
    const next = await owner.replace(make);
    expect(next).not.toBe(first);
    expect(created).toBe(2);
    expect(closed).toBe(1);
    await Promise.all([owner.close(), owner.close()]);
    expect(closed).toBe(2);
    expect(created).toBe(2);
  });

  test("failed close preserves the exact cleanup error and refuses destructive replacement", async () => {
    const original = new Error("fixture close failed");
    let creates = 0;
    const connection = createMockDatabaseConnection(async () => [], {
      close: async () => {
        throw original;
      },
    });
    const owner = new FixtureDatabase(() => connection);
    owner.connection();
    await expect(
      owner.replace(() => {
        creates++;
        return {} as DatabaseConnection;
      }),
    ).rejects.toBe(original);
    expect(creates).toBe(0);
    expect(() => owner.connection()).toThrow("cleanup or replacement is pending or failed");
    await expect(owner.close()).rejects.toBe(original);
  });
});

test("overlapping replacement is refused and close joins then closes the accepted replacement", async () => {
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const closing = new Promise<void>((resolve) => {
    started = resolve;
  });
  const events: string[] = [];
  const first = createMockDatabaseConnection(async () => [], {
    close: async () => {
      events.push("first.close");
      started();
      await gate;
    },
  });
  const next = createMockDatabaseConnection(async () => [], {
    close: async () => {
      events.push("next.close");
    },
  });
  const owner = new FixtureDatabase(() => first);
  owner.connection();
  const replacement = owner.replace(() => {
    events.push("next.create");
    return next;
  });
  let close: Promise<void> | undefined;
  try {
    await closing;
    await expect(
      owner.replace(() => {
        events.push("orphan.create");
        return next;
      }),
    ).rejects.toThrow("transition is already active");
    expect(() => owner.connection()).toThrow("pending or failed");
    close = owner.close();
    expect(owner.close()).toBe(close);
    expect(() => owner.connection()).toThrow("pending or failed");
  } finally {
    release();
    await replacement;
    await (close ?? owner.close());
  }
  expect(events).toEqual(["first.close", "next.create", "next.close"]);
});
