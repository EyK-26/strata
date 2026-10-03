import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerOpenApiRouteMap } from "@getstrata/bootstrap/buildModuleRoutes";
import { routeRegistry } from "@getstrata/bootstrap/routeRegistry";
import { generateOpenApiSpec } from "@getstrata/core/openapi/generator";
import {
  createOpenApiGenerateCommand,
  registerAppOpenApiRoutes,
} from "../../../packages/strata-cli/src/openapi";
import { restoreEnvVar } from "../../helpers/restoreEnv";
import { captureConsole, repoRoot } from "./helpers";

const tempDirectories: string[] = [];

afterEach(async () => {
  process.chdir(repoRoot);
  routeRegistry.clear();

  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

async function withTempWorkspace(run: (workspace: string) => Promise<void>): Promise<void> {
  const created = await mkdtemp(join(tmpdir(), "strata-openapi-generate-"));
  tempDirectories.push(created);
  const workspace = await realpath(created);
  process.chdir(workspace);
  await run(workspace);
}

describe("createOpenApiGenerateCommand", () => {
  test("creates docs/ when the output directory is missing", async () => {
    await withTempWorkspace(async (workspace) => {
      expect(existsSync(join(workspace, "docs"))).toBe(false);

      const command = createOpenApiGenerateCommand(async () => ({ routes: {} }));
      const output = captureConsole();

      try {
        await command();
      } finally {
        output.restore();
      }

      const jsonPath = join(workspace, "docs/openapi.json");
      const contents = await readFile(jsonPath, "utf8");
      expect(contents).toContain('"openapi"');
      expect(output.logs[0]).toMatch(
        /^OpenAPI spec written to .*docs\/openapi\.json \(\d+ routes\)\.$/,
      );
    });
  });

  test("still writes docs/openapi.json when docs/ already exists", async () => {
    await withTempWorkspace(async (workspace) => {
      await mkdir(join(workspace, "docs"), { recursive: true });

      const command = createOpenApiGenerateCommand(async () => ({ routes: {} }));
      const output = captureConsole();

      try {
        await command();
      } finally {
        output.restore();
      }

      expect(existsSync(join(workspace, "docs/openapi.json"))).toBe(true);
    });
  });
});

describe("registerAppOpenApiRoutes", () => {
  test("excludes HTML and hybrid SPA routes while keeping API and health routes", async () => {
    const previousPrefix = process.env.SPA_PREFIX;
    process.env.SPA_PREFIX = "/app";

    try {
      await registerAppOpenApiRoutes(async () => {
        const routes = {
          "/api/v1/products": async () => new Response("ok"),
          "/admin/notes": async () => new Response("<html></html>"),
          "/app": async () => new Response("<html></html>"),
          "/app/": async () => new Response("<html></html>"),
          "/app/*": async () => new Response("<html></html>"),
          "/*": async () => new Response("not found"),
          "/health": async () => new Response("ok"),
        };

        registerOpenApiRouteMap(
          { "/api/v1/products": routes["/api/v1/products"] },
          ["global", "api"],
        );
        registerOpenApiRouteMap({ "/admin/notes": routes["/admin/notes"] }, ["global", "web"]);

        return { routes };
      });

      const spec = generateOpenApiSpec(routeRegistry.list());
      expect(Object.keys(spec.paths).sort()).toEqual(["/api/v1/products", "/health"]);
    } finally {
      restoreEnvVar("SPA_PREFIX", previousPrefix);
    }
  });

  test("keeps a path that is registered as both web and api", async () => {
    await registerAppOpenApiRoutes(async () => {
      const routes = {
        "/notes": {
          GET: async () => new Response("<html></html>"),
          POST: async () => new Response("{}"),
        },
      };

      registerOpenApiRouteMap({ "/notes": { GET: routes["/notes"].GET } }, ["global", "web"]);
      registerOpenApiRouteMap({ "/notes": { POST: routes["/notes"].POST } }, ["global", "api"]);

      return { routes };
    });

    const spec = generateOpenApiSpec(routeRegistry.list());
    expect(Object.keys(spec.paths)).toEqual(["/notes"]);
    expect(spec.paths["/notes"]?.get).toBeDefined();
    expect(spec.paths["/notes"]?.post).toBeDefined();
  });

  test("drops a custom SPA_PREFIX instead of the default /app", async () => {
    const previousPrefix = process.env.SPA_PREFIX;
    process.env.SPA_PREFIX = "/portal";

    try {
      await registerAppOpenApiRoutes(async () => {
        const routes = {
          "/api/v1/products": async () => new Response("ok"),
          "/portal": async () => new Response("<html></html>"),
          "/portal/dashboard": async () => new Response("<html></html>"),
          "/app/legacy": async () => new Response("ok"),
        };

        registerOpenApiRouteMap(
          {
            "/api/v1/products": routes["/api/v1/products"],
            "/app/legacy": routes["/app/legacy"],
          },
          ["global", "api"],
        );

        return { routes };
      });

      const spec = generateOpenApiSpec(routeRegistry.list());
      expect(Object.keys(spec.paths).sort()).toEqual(["/api/v1/products", "/app/legacy"]);
    } finally {
      restoreEnvVar("SPA_PREFIX", previousPrefix);
    }
  });
});
