import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import {
  dialectFor,
  resetSqlDialect,
  sqlTimestamp,
  useSqlDialect,
} from "@getstrata/core/database/dialect";

afterEach(() => {
  resetSqlDialect();
});

const SAMPLE = new Date("2026-09-20T18:41:51.597Z");

describe("dialect timestampValue", () => {
  test("postgres keeps ISO-8601 because TIMESTAMPTZ parses it", () => {
    expect(dialectFor("pgsql").timestampValue(SAMPLE)).toBe("2026-09-20T18:41:51.597Z");
  });

  test("sqlite keeps ISO-8601 because timestamps are stored as text", () => {
    expect(dialectFor("sqlite").timestampValue(SAMPLE)).toBe("2026-09-20T18:41:51.597Z");
  });

  test("mysql drops the T separator and the trailing Z", () => {
    // MySQL DATETIME rejects "2026-09-20T18:41:51.597Z" with
    // "Incorrect datetime value", which broke cookie sessions on MySQL.
    expect(dialectFor("mysql").timestampValue(SAMPLE)).toBe("2026-09-20 18:41:51");
  });
});

describe("sqlTimestamp", () => {
  test("follows the active dialect", () => {
    useSqlDialect("mysql");
    expect(sqlTimestamp(SAMPLE)).toBe("2026-09-20 18:41:51");

    useSqlDialect("pgsql");
    expect(sqlTimestamp(SAMPLE)).toBe("2026-09-20T18:41:51.597Z");

    useSqlDialect("sqlite");
    expect(sqlTimestamp(SAMPLE)).toBe("2026-09-20T18:41:51.597Z");
  });

  test("defaults to the current time", () => {
    useSqlDialect("mysql");
    const before = Date.now();
    const rendered = sqlTimestamp();
    expect(rendered).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(new Date(`${rendered.replace(" ", "T")}Z`).getTime()).toBeGreaterThanOrEqual(
      before - 1000,
    );
  });
});

describe("sqlite nowExpression matches timestampValue", () => {
  test("renders ISO-8601 with T and Z so text comparisons are exact", () => {
    const db = new Database(":memory:");
    const now = db.query(`SELECT ${dialectFor("sqlite").nowExpression()} AS now`).get() as {
      now: string;
    };
    expect(now.now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Math.abs(new Date(now.now).getTime() - Date.now())).toBeLessThan(5_000);
    db.close();
  });

  test("an expired ISO timestamp is not greater than now on the same day", () => {
    // CURRENT_TIMESTAMP ("YYYY-MM-DD HH:MM:SS") sorted before any same-day ISO value.
    const db = new Database(":memory:");
    const nowExpression = dialectFor("sqlite").nowExpression();
    const expired = dialectFor("sqlite").timestampValue(new Date(Date.now() - 60 * 60 * 1000));
    const future = dialectFor("sqlite").timestampValue(new Date(Date.now() + 60 * 60 * 1000));
    const row = db
      .query(
        `SELECT (? > ${nowExpression}) AS expired_valid, (? > ${nowExpression}) AS future_valid`,
      )
      .get(expired, future) as { expired_valid: number; future_valid: number };
    expect(row.expired_valid).toBe(0);
    expect(row.future_valid).toBe(1);
    db.close();
  });
});
