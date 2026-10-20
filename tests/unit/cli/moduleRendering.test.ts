import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeModuleCommand } from "../../../packages/strata-cli/src/scaffold/makeModule";
import { renderModuleScaffold } from "../../../packages/strata-cli/src/scaffold/renderModule";
import baselines from "../../fixtures/scaffolds/module-rendering.sha256.json";
import { captureConsole } from "./helpers";

/** Retain the frozen mechanical-extraction proof, allowing only the declared typing edits. */
function restoreUntypedBaseline(path: string, source: string): string {
  if (path.endsWith("/controller.ts")) {
    const typedRequests = source.match(
      /async \(_request: RouteRequest<\w+IdParams>, record\) => \{/g,
    );
    expect(typedRequests).toHaveLength(2);
    return source.replaceAll(
      /async \(_request: RouteRequest<\w+IdParams>, record\) => \{/g,
      "async (_request, record) => {",
    );
  }
  if (path.endsWith("/routes.ts")) {
    expect(source).not.toContain("as unknown as RouteHandler");
    expect(source).not.toContain("import type { RouteHandler }");
    let original = source.replace(
      'import type { AppDependencies, CachedJson } from "@getstrata/core/contracts/di";\n',
      'import type { AppDependencies, CachedJson } from "@getstrata/core/contracts/di";\nimport type { RouteHandler } from "@getstrata/core/http/middleware";\n',
    );
    for (const action of ["store", "update", "destroy"]) {
      expect(source.match(new RegExp(`controller\\.${action},`, "g"))).toHaveLength(1);
      original = original.replace(
        `controller.${action},`,
        `controller.${action} as unknown as RouteHandler,`,
      );
    }
    return original;
  }
  if (path.endsWith("/webRoutes.ts")) {
    expect(source).not.toContain("as unknown as RouteHandler");
    expect(source).not.toContain("import type { RouteHandler }");
    expect(source.match(/kernel.wrapWebPublicRead\(controller.index\)/g)).toHaveLength(1);
    return source
      .replace(
        'import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";\n',
        'import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";\nimport type { RouteHandler } from "@getstrata/core/http/middleware";\n',
      )
      .replace(
        "kernel.wrapWebPublicRead(controller.index)",
        "kernel.wrapWebPublicRead(controller.index as unknown as RouteHandler)",
      );
  }
  return source;
}

for (const { profile, files: expected } of baselines) {
  test(`module rendering preserves the frozen baseline outside declared handler types: ${profile.name}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "strata-module-rendering-"));
    const previousCwd = process.cwd();
    const output = captureConsole();
    try {
      await mkdir(join(directory, "src/models"), { recursive: true });
      await writeFile(join(directory, "src/models/register.ts"), "// Existing model registry\n");
      if (profile.views) await mkdir(join(directory, "views"));
      process.chdir(directory);
      await makeModuleCommand(...(profile.withWeb ? ["--with-web"] : []), profile.name);
      const actual: Record<string, unknown> = {};
      async function visit(path: string): Promise<void> {
        for (const item of await readdir(path, { withFileTypes: true })) {
          const full = join(path, item.name);
          if (item.isDirectory()) await visit(full);
          else {
            const relative = full.slice(directory.length + 1);
            actual[relative] = createHash("sha256")
              .update(restoreUntypedBaseline(relative, await readFile(full, "utf8")))
              .digest("hex");
          }
        }
      }
      await visit(directory);
      expect(actual).toEqual(expected);
    } finally {
      output.restore();
      process.chdir(previousCwd);
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("rendering produces independent in-memory manifests without writing to disk", () => {
  const options = {
    moduleSlug: "item",
    moduleName: "Item",
    moduleIdentifier: "item",
    withWeb: true,
  };
  const first = renderModuleScaffold(options);
  const originalController = first.files.get("controller.ts");
  first.files.set("controller.ts", "caller-edited");
  const next = renderModuleScaffold(options);
  expect(next.files.get("controller.ts")).toBe(originalController);
  expect(next.webFiles.has("webController.ts")).toBe(true);
  expect(next.viewFiles.has("index.eta")).toBe(true);
});
