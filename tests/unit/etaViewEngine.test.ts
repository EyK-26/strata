import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { restoreEnvVar } from "../helpers/restoreEnv";

describe("EtaViewEngine", () => {
  let viewsDirectory = "";
  const previousFrontendMode = process.env.FRONTEND_MODE;

  beforeAll(async () => {
    viewsDirectory = await mkdtemp(join(tmpdir(), "workhub-views-"));
    await writeFile(
      join(viewsDirectory, "hello.eta"),
      "<h1><%= it.title %></h1><p><%= it.message %></p>",
    );
  });

  afterAll(async () => {
    if (previousFrontendMode === undefined) {
      delete process.env.FRONTEND_MODE;
    } else {
      restoreEnvVar("FRONTEND_MODE", previousFrontendMode);
    }

    await rm(viewsDirectory, { recursive: true, force: true });
  });

  test("renders templates from the configured views directory", async () => {
    const { EtaViewEngine } = await import("@getstrata/core/view/etaViewEngine");
    const engine = new EtaViewEngine(viewsDirectory);

    const html = await engine.render(
      "hello",
      {
        title: "Hello",
        message: "World",
      },
      { layout: false },
    );

    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain("<p>World</p>");
  });
});
