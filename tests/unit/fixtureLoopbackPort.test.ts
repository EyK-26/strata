import { expect, test } from "bun:test";
import { replaceFixtureLoopbackPort } from "../helpers/fixtureLoopbackPort";

test("Docker fixture port remapping never rewrites its own result or a longer port", () => {
  for (const [port, hostPort] of [
    [3306, "33060"],
    [5432, "54320"],
    [6379, "63790"],
  ] as const) {
    const input = `DATABASE_URL=mysql://user:password@localhost:${port}/app\nREDIS_URL=redis://127.0.0.1:${port}\nOTHER=http://localhost:${port}1/keep\n`;
    expect(replaceFixtureLoopbackPort(input, port, hostPort)).toBe(
      `DATABASE_URL=mysql://user:password@127.0.0.1:${hostPort}/app\nREDIS_URL=redis://127.0.0.1:${hostPort}\nOTHER=http://localhost:${port}1/keep\n`,
    );
  }
});
