import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { assertEtaHtmlSource } from "@getstrata/core/view/assertEtaHtmlSource";
import { restoreEnvVar } from "../helpers/restoreEnv";

async function collectEtaFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectEtaFiles(path)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".eta")) {
      files.push(path);
    }
  }

  return files;
}

describe("EtaViewEngine", () => {
  let viewsDirectory = "";
  const previousFrontendMode = process.env.FRONTEND_MODE;

  beforeAll(async () => {
    viewsDirectory = await mkdtemp(join(tmpdir(), "workhub-views-"));
    await mkdir(join(viewsDirectory, "layouts"), { recursive: true });
    await mkdir(join(viewsDirectory, "partials"), { recursive: true });

    await writeFile(
      join(viewsDirectory, "hello.eta"),
      "<h1><%= it.title %></h1><p><%= it.message %></p>",
    );
    await writeFile(
      join(viewsDirectory, "partials", "blurb.eta"),
      '<p class="blurb"><%= it.message %></p>',
    );
    await writeFile(
      join(viewsDirectory, "page.eta"),
      `<section class="section">
  <h1><%= it.title %></h1>
  <%~ include("./partials/blurb", it) %>
</section>
`,
    );
    await writeFile(
      join(viewsDirectory, "layouts", "app.eta"),
      `<!doctype html>
<html>
  <body>
    <main>
      <%~ it.body %>
    </main>
  </body>
</html>
`,
    );
    await writeFile(
      join(viewsDirectory, "forum.eta"),
      `section.section
  h1 Forum
  a.card href="/learn/<%= it.slug %>"
    h3><%= it.title %>
`,
    );
    await writeFile(
      join(viewsDirectory, "with-script.eta"),
      `<section class="section">
  <h1><%= it.title %></h1>
  <script>
    document.addEventListener("DOMContentLoaded", () => {
      const link = document.querySelector("a");
      if (link) {
        link.href = "/ok";
      }
    });
  </script>
</section>
`,
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

  test("renders layouts and include() as HTML", async () => {
    const { EtaViewEngine } = await import("@getstrata/core/view/etaViewEngine");
    const engine = new EtaViewEngine(viewsDirectory);

    const html = await engine.render("page", {
      title: "Forum",
      message: "Welcome",
    });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<h1>Forum</h1>");
    expect(html).toContain('<p class="blurb">Welcome</p>');
    expect(html).not.toContain("section.section");
  });

  test("throws when a template uses Pug-like shorthand", async () => {
    const { EtaViewEngine } = await import("@getstrata/core/view/etaViewEngine");
    const engine = new EtaViewEngine(viewsDirectory);

    const renderPug = engine.render("forum", { slug: "intro", title: "Hello" }, { layout: false });

    await expect(renderPug).rejects.toThrow(/forum\.eta/);
    await expect(
      engine.render("forum", { slug: "intro", title: "Hello" }, { layout: false }),
    ).rejects.toThrow(/Pug/);
    await expect(
      engine.render("forum", { slug: "intro", title: "Hello" }, { layout: false }),
    ).rejects.toThrow(/HTML/);
  });

  test("does not treat JavaScript inside script blocks as Pug", async () => {
    const { EtaViewEngine } = await import("@getstrata/core/view/etaViewEngine");
    const engine = new EtaViewEngine(viewsDirectory);

    const html = await engine.render("with-script", { title: "Safe" }, { layout: false });

    expect(html).toContain("<h1>Safe</h1>");
    expect(html).toContain('link.href = "/ok"');
  });
});

describe("assertEtaHtmlSource", () => {
  test("accepts committed WorkHub and scaffold HTML+Eta views", async () => {
    const roots = [
      join(process.cwd(), "resources/views"),
      join(process.cwd(), "templates"),
      join(process.cwd(), "packages/strata-starter/templates"),
    ];

    for (const root of roots) {
      for (const file of await collectEtaFiles(root)) {
        const source = await readFile(file, "utf8");
        expect(() => assertEtaHtmlSource(relative(process.cwd(), file), source)).not.toThrow();
      }
    }
  });

  test("rejects piped Pug text", () => {
    expect(() => assertEtaHtmlSource("notes.eta", "| leftover pug text")).toThrow(/notes\.eta/);
    expect(() => assertEtaHtmlSource("notes.eta", "| leftover pug text")).toThrow(/Pug/);
  });
});
