import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileRouteMap, composeRouteMaps } from "@getstrata/bootstrap/routePlan";
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

      let cleanupRuns = 0;
      const command = createOpenApiGenerateCommand(
        async () => ({ routes: {} }),
        () => {
          cleanupRuns++;
        },
      );
      const output = captureConsole();

      try {
        await command();
      } finally {
        output.restore();
      }

      const jsonPath = join(workspace, "docs/openapi.json");
      const contents = await readFile(jsonPath, "utf8");
      expect(contents).toContain('"openapi"');
      expect(cleanupRuns).toBe(1);
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
  test("returns explicit immutable metadata excluding HTML and hybrid SPA routes", async () => {
    const previousPrefix = process.env.SPA_PREFIX;
    process.env.SPA_PREFIX = "/app";
    try {
      const inventory = await registerAppOpenApiRoutes(async () => ({
        routes: composeRouteMaps(
          compileRouteMap(
            { "/api/v1/products": () => new Response("ok") },
            { middleware: ["global", "api"] },
          ),
          compileRouteMap(
            { "/admin/notes": () => new Response("html") },
            { middleware: ["global", "web"] },
          ),
          {
            "/app": () => new Response(),
            "/app/": () => new Response(),
            "/app/*": () => new Response(),
            "/*": () => new Response(),
            "/health": () => new Response(),
          },
        ),
      }));
      expect(Object.keys(generateOpenApiSpec(inventory).paths).sort()).toEqual([
        "/api/v1/products",
        "/health",
      ]);
      expect(Object.isFrozen(inventory)).toBe(true);
      expect(Object.isFrozen(inventory[0]?.middleware)).toBe(true);
    } finally {
      restoreEnvVar("SPA_PREFIX", previousPrefix);
    }
  });

  test("keeps a path shared by explicit web and api operations", async () => {
    const inventory = await registerAppOpenApiRoutes(async () => ({
      routes: composeRouteMaps(
        compileRouteMap(
          { "/notes": { GET: () => new Response("html") } },
          { middleware: ["global", "web"] },
        ),
        compileRouteMap(
          { "/notes": { POST: () => new Response("{}") } },
          { middleware: ["global", "api"] },
        ),
      ),
    }));
    const spec = generateOpenApiSpec(inventory);
    expect(Object.keys(spec.paths)).toEqual(["/notes"]);
    expect(spec.paths["/notes"]?.get).toBeDefined();
    expect(spec.paths["/notes"]?.post).toBeDefined();
  });

  test("drops a custom SPA_PREFIX and isolates concurrent CLI bootstraps", async () => {
    const previousPrefix = process.env.SPA_PREFIX;
    process.env.SPA_PREFIX = "/portal";
    try {
      const [first, second] = await Promise.all([
        registerAppOpenApiRoutes(
          async () => ({
            routes: {
              "/api/v1/products": () => new Response(),
              "/portal": () => new Response(),
              "/portal/dashboard": () => new Response(),
              "/app/legacy": () => new Response(),
            },
          }),
          "/portal",
        ),
        registerAppOpenApiRoutes(
          async () => ({
            routes: { "/other": { POST: () => new Response() } },
          }),
          "/portal",
        ),
      ]);
      expect(Object.keys(generateOpenApiSpec(first).paths).sort()).toEqual([
        "/api/v1/products",
        "/app/legacy",
      ]);
      expect(Object.keys(generateOpenApiSpec(second).paths)).toEqual(["/other"]);
      expect(Object.keys(generateOpenApiSpec(first).paths).sort()).toEqual([
        "/api/v1/products",
        "/app/legacy",
      ]);
    } finally {
      restoreEnvVar("SPA_PREFIX", previousPrefix);
    }
  });
});

test("OpenAPI closes after bootstrap or output failure and propagates cleanup failure", async () => {
  let closes = 0;
  const close = () => {
    closes++;
  };
  const bootFailure = new Error("bootstrap failed");
  await expect(
    createOpenApiGenerateCommand(async () => {
      throw bootFailure;
    }, close)(),
  ).rejects.toBe(bootFailure);
  expect(closes).toBe(1);
  await withTempWorkspace(async (workspace) => {
    await Bun.write(join(workspace, "docs"), "not a directory");
    await expect(
      createOpenApiGenerateCommand(async () => ({ routes: {} }), close)(),
    ).rejects.toThrow();
    expect(closes).toBe(2);
  });
  await withTempWorkspace(async () => {
    const failure = new Error("cleanup failed");
    await expect(
      createOpenApiGenerateCommand(
        async () => ({ routes: {} }),
        () => {
          throw failure;
        },
      )(),
    ).rejects.toBe(failure);
  });
});

test("OpenAPI SPA filtering keeps the selected owner across asynchronous bootstrap", async () => {
  const previous = process.env.SPA_PREFIX;
  try {
    process.env.SPA_PREFIX = "/other";
    const routes = await registerAppOpenApiRoutes(async () => {
      await Promise.resolve();
      process.env.SPA_PREFIX = "/api";
      return { routes: { "/portal": () => new Response(), "/api": () => new Response() } };
    }, "/portal");
    expect(routes.map((route) => route.path)).toEqual(["/api"]);
  } finally {
    restoreEnvVar("SPA_PREFIX", previous);
  }
});
