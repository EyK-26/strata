import { describe, expect, test } from "bun:test";
import { type CreateBunSqlPoolOptions, createBunSqlPool } from "@getstrata/core/database/bunSql";
import { SQL } from "bun";

// Use independent pools and SELECTs only: no default-connection rebinding,
// application tables, shortened worker leases or retries of ambiguous writes.
const factories = [
  { name: "native Bun.SQL", create: (options: CreateBunSqlPoolOptions) => new SQL(options) },
  { name: "public createBunSqlPool", create: createBunSqlPool },
];
const quietMs = 1600;

for (const factory of factories) {
  describe(`${factory.name}: active connection timer ownership`, () => {
    for (const timer of ["idle", "lifetime"] as const) {
      const options = () => {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error("Postgres DATABASE_URL is required for SQL timer qualification.");
        return {
          url,
          max: 1,
          connectionTimeout: 4,
          idleTimeout: timer === "idle" ? 1 : 30,
          maxLifetime: timer === "lifetime" ? 1 : 3600,
        };
      };

      test(`${timer} timer preserves a quiet open transaction`, async () => {
        const pool = factory.create(options());
        try {
          const result = await pool.begin(async (transaction) => {
            const [before] = await transaction.unsafe<{ pid: number }[]>(
              "SELECT pg_backend_pid() AS pid",
            );
            expect(before?.pid).toBeNumber();
            await Bun.sleep(quietMs);
            const [after] = await transaction.unsafe<{ pid: number }[]>(
              "SELECT pg_backend_pid() AS pid",
            );
            expect(after?.pid).toBe(before?.pid);
            return "committed";
          });
          expect(result).toBe("committed");
          expect(await pool.unsafe("SELECT 1 AS recovered")).toEqual([{ recovered: 1 }]);
        } finally {
          await pool.close({ timeout: 0 });
        }
      }, 10_000);

      test(`${timer} timer preserves an explicitly reserved connection`, async () => {
        const pool = factory.create(options());
        try {
          const reserved = await pool.reserve();
          try {
            const [before] = await reserved.unsafe<{ pid: number }[]>(
              "SELECT pg_backend_pid() AS pid",
            );
            expect(before?.pid).toBeNumber();
            await Bun.sleep(quietMs);
            const [after] = await reserved.unsafe<{ pid: number }[]>(
              "SELECT pg_backend_pid() AS pid",
            );
            expect(after?.pid).toBe(before?.pid);
          } finally {
            reserved.release();
          }
          expect(await pool.unsafe("SELECT 1 AS recovered")).toEqual([{ recovered: 1 }]);
        } finally {
          await pool.close({ timeout: 0 });
        }
      }, 10_000);

      test(`${timer} timer does not interrupt an in-flight statement`, async () => {
        const pool = factory.create(options());
        try {
          const [before] = await pool.unsafe<{ pid: number }[]>("SELECT pg_backend_pid() AS pid");
          expect(before?.pid).toBeNumber();
          const [during] = await pool.unsafe<{ pid: number }[]>(
            "SELECT pg_backend_pid() AS pid, pg_sleep($1)",
            [quietMs / 1000],
          );
          expect(during?.pid).toBe(before?.pid);
          expect(await pool.unsafe("SELECT 1 AS recovered")).toEqual([{ recovered: 1 }]);
        } finally {
          await pool.close({ timeout: 0 });
        }
      }, 10_000);

      test(`${timer} timer still retires an unreserved idle connection`, async () => {
        const pool = factory.create(options());
        try {
          const [before] = await pool.unsafe<{ pid: number }[]>("SELECT pg_backend_pid() AS pid");
          await Bun.sleep(quietMs);
          const [after] = await pool.unsafe<{ pid: number }[]>("SELECT pg_backend_pid() AS pid");
          expect(before?.pid).toBeNumber();
          expect(after?.pid).toBeNumber();
          expect(after?.pid).not.toBe(before?.pid);
        } finally {
          await pool.close({ timeout: 0 });
        }
      }, 10_000);
    }
  });
}

test("public pool defaults preserve a transaction beyond the actual 30-second idle deadline", async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Postgres DATABASE_URL is required for SQL timer qualification.");
  const pool = createBunSqlPool({ url, max: 1 });
  try {
    const result = await pool.begin(async (transaction) => {
      const [before] = await transaction.unsafe<{ pid: number }[]>(
        "SELECT pg_backend_pid() AS pid",
      );
      expect(before?.pid).toBeNumber();
      await Bun.sleep(31_600);
      const [after] = await transaction.unsafe<{ pid: number }[]>("SELECT pg_backend_pid() AS pid");
      expect(after?.pid).toBe(before?.pid);
      return "committed";
    });
    expect(result).toBe("committed");
    expect(await pool.unsafe("SELECT 1 AS recovered")).toEqual([{ recovered: 1 }]);
  } finally {
    await pool.close({ timeout: 0 });
  }
}, 40_000);
