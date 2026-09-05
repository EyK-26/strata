import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createMysqlConnection } from "@getstrata/core/database/mysqlConnection";
import {
  getNamedConnection,
  hasNamedConnection,
  registerNamedConnection,
  unregisterNamedConnection,
} from "@getstrata/core/database/namedConnections";
import { jobBoardService } from "../modules/jobBoard/service.ts";
import { bootHiroapp } from "./helpers.ts";

const enabled = process.env.HIROAPP_TEST === "1";

describe.skipIf(!enabled)("MySQL job-board mirror", () => {
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(async () => {
    const boot = await bootHiroapp();
    server = boot.server;
  });

  afterAll(() => {
    server?.stop(true);
  });

  async function withJobBoard<T>(
    handle: { unsafe: (sql: string, params?: readonly unknown[]) => Promise<unknown[]> },
    callback: () => Promise<T>,
  ): Promise<T> {
    const existed = hasNamedConnection("job-board");
    const previous = existed ? getNamedConnection("job-board") : null;
    registerNamedConnection("job-board", "mysql", handle);
    try {
      return await callback();
    } finally {
      if (previous) {
        registerNamedConnection("job-board", previous.driver, previous.connection);
      } else {
        unregisterNamedConnection("job-board");
      }
    }
  }

  test("no-ops when the sidecar is not registered", async () => {
    const existed = hasNamedConnection("job-board");
    const previous = existed ? getNamedConnection("job-board") : null;
    unregisterNamedConnection("job-board");
    try {
      await jobBoardService.upsertPublished({
        careerPostingId: 1,
        positionId: 2,
        title: "Engineer",
        description: "hire",
        pinned: false,
      });
      await jobBoardService.remove(1);
    } finally {
      if (previous) {
        registerNamedConnection("job-board", previous.driver, previous.connection);
      }
    }
  });

  test("upserts and deletes through the named MySQL connection", async () => {
    const sql: string[] = [];
    await withJobBoard(
      {
        async unsafe(query) {
          sql.push(query);
          return [];
        },
      },
      async () => {
        await jobBoardService.upsertPublished({
          careerPostingId: 9,
          positionId: 3,
          title: "Designer",
          description: null,
          pinned: true,
        });
        await jobBoardService.remove(9);
      },
    );
    expect(sql.some((query) => query.includes("CREATE TABLE"))).toBe(true);
    expect(sql.some((query) => query.includes("INSERT INTO job_board_posts"))).toBe(true);
    expect(sql.some((query) => query.includes("DELETE FROM job_board_posts"))).toBe(true);
  });

  test("swallows sidecar failures so hiring stays on Postgres", async () => {
    await withJobBoard(
      {
        async unsafe() {
          throw new Error("mysql down");
        },
      },
      async () => {
        await jobBoardService.upsertPublished({
          careerPostingId: 4,
          positionId: 5,
          title: "PM",
          description: "lead",
          pinned: false,
        });
        await jobBoardService.remove(4);
      },
    );
  });

  test("writes a real row when MYSQL_URL is reachable", async () => {
    const url = process.env.MYSQL_URL?.trim();
    if (!url) {
      return;
    }
    const live = createMysqlConnection(url);
    try {
      await live.unsafe("SELECT 1");
    } catch {
      await live.close();
      return;
    }
    await withJobBoard(live, async () => {
      await jobBoardService.upsertPublished({
        careerPostingId: 4242,
        positionId: 7,
        title: "Live mirror",
        description: "ci",
        pinned: false,
      });
      const rows = await live.unsafe<{ title: string }>(
        "SELECT title FROM job_board_posts WHERE career_posting_id = ?",
        [4242],
      );
      expect(rows.some((row) => row.title === "Live mirror")).toBe(true);
      await jobBoardService.remove(4242);
    });
    await live.close();
  });
});
