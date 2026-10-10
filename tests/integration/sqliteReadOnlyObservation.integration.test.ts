import { expect, test } from "bun:test";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseConnection } from "@getstrata/core/database/baseRepository";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { observeIsolatedReadOnly } from "../../src/core/database/isolatedReadOnlyObservation";
import { restoreEnvVar } from "../helpers/restoreEnv";

async function fixture(
  run: (db: ReturnType<typeof createSqliteConnection>, filename: string) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "sqlite-observe-"));
  const filename = join(directory, "app.sqlite");
  const db = createSqliteConnection(filename);
  try {
    await db.unsafe("CREATE TABLE source (id INTEGER PRIMARY KEY, value TEXT)");
    await db.unsafe("INSERT INTO source VALUES (1, 'private')");
    await run(db, filename);
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
}
const options = () => ({ signal: new AbortController().signal, timeoutMs: 1000 });

test("independent read-only SQLite snapshots preserve rows and reject writes", async () => {
  await fixture(async (db, filename) => {
    const writer = createSqliteConnection(filename);
    const scope = await db.observeReadOnly(async (tx) => {
      const first = await tx.unsafe<{ value: string }>("SELECT value FROM source WHERE id=?", [1]);
      await writer.unsafe("UPDATE source SET value='changed' WHERE id=1");
      await expect(db.unsafe("UPDATE source SET value='bad'")).rejects.toThrow(
        "Read-only SQL observation failed",
      );
      expect(await tx.unsafe("SELECT value FROM source")).toEqual(first);
      await expect(tx.unsafe("UPDATE source SET value='bad'")).rejects.toThrow(
        "Read-only SQL observation failed",
      );
      return tx;
    }, options());
    writer.close();
    await expect(scope.unsafe("SELECT 1")).rejects.toThrow("closed");
    expect(await db.unsafe("SELECT value FROM source")).toEqual([{ value: "changed" }]);
    await expect(
      observeIsolatedReadOnly(
        { driver: "sqlite", filename: join(filename, "missing") },
        async () => {},
        options(),
      ),
    ).rejects.toThrow("Read-only SQL observation failed");
    await expect(
      db.observeReadOnly(async () => {
        throw new Error("callback failed");
      }, options()),
    ).rejects.toThrow("callback failed");
    expect(
      await db.observeReadOnly(
        (tx) => tx.unsafe("SELECT ? AS v", [new Date("2020-01-01T00:00:00Z")]),
        options(),
      ),
    ).toEqual([{ v: "2020-01-01T00:00:00.000Z" }]);
  });
});

test("native process termination bounds SQLite VM work and leaves the business connection usable", async () => {
  await fixture(async (db) => {
    let clockTicks = 0;
    const clock = setInterval(() => {
      clockTicks++;
    }, 5);
    const start = performance.now();
    let retained: DatabaseConnection | undefined;
    try {
      await expect(
        db.observeReadOnly(
          async (tx) => {
            retained = tx;
            return tx.unsafe(
              "WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n",
            );
          },
          { ...options(), timeoutMs: 500 },
        ),
      ).rejects.toThrow("timed out");
      expect(performance.now() - start).toBeLessThan(2000);
      expect(clockTicks).toBeGreaterThan(0);
      expect(retained).toBeDefined();
      await expect(retained?.unsafe("SELECT 1")).rejects.toThrow("closed");
      expect(await db.unsafe("SELECT count(*) AS n FROM source")).toEqual([{ n: 1 }]);
      expect(await db.observeReadOnly((tx) => tx.unsafe("SELECT 1 AS n"), options())).toEqual([
        { n: 1 },
      ]);
    } finally {
      clearInterval(clock);
    }
  });
});

test("abort rejects pending reads, prevents late admission and drains before pool closure", async () => {
  await fixture(async (db) => {
    const controller = new AbortController();
    const failure = new Error("cancelled observation");
    let admitted: () => void = () => {};
    const admission = new Promise<void>((resolve) => {
      admitted = resolve;
    });
    const work = db.observeReadOnly(
      async (tx) => {
        admitted();
        return tx.unsafe(
          "WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n",
        );
      },
      { signal: controller.signal, timeoutMs: 1000 },
    );
    await admission;
    expect(() => db.close()).toThrow("Drain SQLite operations");
    controller.abort(failure);
    await expect(work).rejects.toBe(failure);
    const pre = new AbortController();
    pre.abort(failure);
    let callbacks = 0;
    await expect(
      db.observeReadOnly(
        async () => {
          callbacks++;
        },
        { signal: pre.signal, timeoutMs: 1000 },
      ),
    ).rejects.toBe(failure);
    expect(callbacks).toBe(0);
  });
});

test("observation admission rejects memory databases, closed adapters, invalid deadlines and missing Bun", async () => {
  const memory = createSqliteConnection(":memory:");
  await expect(memory.observeReadOnly(async () => {}, options())).rejects.toThrow("file-backed");
  memory.close();
  await expect(memory.observeReadOnly(async () => {}, options())).rejects.toThrow("closed");
  await fixture(async (db) => {
    for (const timeoutMs of [0, 5001, NaN, 1.5])
      await expect(db.observeReadOnly(async () => {}, { ...options(), timeoutMs })).rejects.toThrow(
        "timeout",
      );
    const previous = process.env.PATH;
    process.env.PATH = "";
    try {
      await expect(db.observeReadOnly(async () => {}, options())).rejects.toThrow("Bun CLI");
    } finally {
      restoreEnvVar("PATH", previous);
    }
    await db.observeReadOnly(async (tx) => {
      const first = tx.unsafe("SELECT 1");
      await expect(tx.unsafe("SELECT 2")).rejects.toThrow("Concurrent");
      await first;
    }, options());
  });
});

test("observation startup ignores application config preloads and env files", async () => {
  await fixture(async (db, filename) => {
    const directory = join(filename, "..");
    const marker = join(directory, "preload-ran");
    await writeFile(
      join(directory, "preload.ts"),
      `await Bun.write(${JSON.stringify(marker)}, process.env.PRIVATE_PASSWORD ?? "none");`,
    );
    await writeFile(join(directory, "bunfig.toml"), 'preload = ["./preload.ts"]\n');
    await writeFile(join(directory, ".env"), "PRIVATE_PASSWORD=fixture-private\n");
    const previous = process.cwd();
    process.chdir(directory);
    try {
      expect(
        await db.observeReadOnly((tx) => tx.unsafe("SELECT count(*) AS n FROM source"), options()),
      ).toEqual([{ n: 1 }]);
      await expect(access(marker)).rejects.toThrow();
    } finally {
      process.chdir(previous);
    }
  });
});
