/** Intentionally MIXED WORKSPACE source/built regression, not clean packed evidence. */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ConfigStore, ServiceContainer } from "@getstrata/core/contracts/container";
import { CORE_VIEW_RENDERER_TOKEN as sourceBarrel } from "@getstrata/core/view";
import { CORE_VIEW_RENDERER_TOKEN as sourceRenderer } from "../../src/core/view/viewRenderer";

const repository = resolve(import.meta.dir, "../..");
const core = await import(
  pathToFileURL(join(repository, "packages/strata-core/dist/index.js")).href
);
const bootstrap = await import(
  pathToFileURL(join(repository, "packages/strata-bootstrap/dist/entries/providers/view.js")).href
);
if (process.argv[2] === "dialect") {
  core.useSqlDialect("mysql");
  try {
    const table = core.defineTable({
      name: "identity_rows",
      primaryKey: "id",
      columns: ["id", "label"],
    });
    const query = core.buildSelectQuery(table, { where: { id: 7 } });
    assert.ok(
      query.text.includes("`identity_rows`"),
      `MySQL identifiers lost root dialect: ${query.text}`,
    );
    assert.ok(query.text.includes("`id`"));
    assert.ok(query.text.includes("?"));
    assert.equal(query.text.includes('"'), false);
    assert.deepEqual(query.params, [7]);
    console.log(
      JSON.stringify({ evidence: "mixed-workspace-source-built", dialect: "mysql", query }),
    );
  } finally {
    core.resetSqlDialect();
  }
} else {
  const directory = await mkdtemp(join(tmpdir(), "strata-mixed-view-token-"));
  try {
    await writeFile(join(directory, "identity.eta"), "<p>mixed-view-token</p>");
    const container = new ServiceContainer();
    const config = new ConfigStore();
    const provider = bootstrap.createViewProvider({
      enabled: true,
      directory,
      layout: false,
      data: { loadUser: async () => null },
    });
    await provider.register({ container, config, dependencies: { container }, onCleanup() {} });
    // Source registration and built consumption must address the same app-owned value.
    const renderer = container.resolve(sourceRenderer);
    assert.equal(container.resolve(sourceBarrel), renderer);
    assert.equal(container.resolve(core.CORE_VIEW_RENDERER_TOKEN), renderer);
    assert.equal(core.CORE_VIEW_RENDERER_TOKEN, sourceRenderer);
    assert.equal(await (await renderer.render("identity")).text(), "<p>mixed-view-token</p>");
    console.log(
      JSON.stringify({
        evidence: "mixed-workspace-source-built",
        providerResolved: true,
        rendered: true,
      }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
