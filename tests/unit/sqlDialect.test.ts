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
