import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import {
  generateProject,
  resolveOverlayRoot,
  resolveTemplateRoot,
} from "../../../packages/strata-starter/src/generate.ts";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../../../packages/strata-starter/src/parseArgs.ts";

test("all 2688 supported starter core/infrastructure shapes generate consistent, parseable output", async () => {
  const root = await mkdtemp(join(tmpdir(), "strata-sanity-matrix-")),
    app = join(root, "app");
  let cases = 0,
    parsed = 0;
  const failures: unknown[] = [];
  async function files(dir: string): Promise<string[]> {
    const es = await readdir(dir, { withFileTypes: true });
    return (
      await Promise.all(
        es.map((e) =>
          e.isDirectory() ? files(join(dir, e.name)) : Promise.resolve([join(dir, e.name)]),
        ),
      )
    ).flat();
  }
  try {
    for (const frontend of ["api", "server-htmx", "spa-react", "hybrid"])
      for (const database of ["sqlite", "mysql", "postgres"])
        for (const auth of [
          "headers",
          "cookie",
          "token",
          "jwt",
          "cookie-token",
          "cookie-token-jwt",
        ])
          for (const tenancy of database === "postgres"
            ? ["none", "column", "rls"]
            : ["none", "column"])
            for (const extras of [false, true])
              for (const cache of ["array", "redis"])
                for (const queue of ["sync", "redis"])
                  for (const mail of ["log", "smtp"]) {
                    const flags = [
                      `--frontend=${frontend}`,
                      `--database=${database}`,
                      `--auth=${auth}`,
                      `--tenancy=${tenancy}`,
                      `--cache=${cache}`,
                      `--queue=${queue}`,
                      `--mail=${mail}`,
                      "--docker",
                      ...(extras
                        ? [
                            "--mfa",
                            "--email-verification",
                            "--scim",
                            "--metrics",
                            "--oauth-github",
                            "--oidc",
                            "--billing",
                            "--webhooks",
                          ]
                        : []),
                    ];
                    const label = [
                      frontend,
                      database,
                      auth,
                      tenancy,
                      extras ? "extras" : "base",
                      cache,
                      queue,
                      mail,
                    ].join("/");
                    try {
                      const warn = console.warn;
                      console.warn = () => {};
                      let layers: ReturnType<typeof layersFromFlags>;
                      try {
                        layers = layersFromFlags(parseCreateStrataArgs(flags));
                      } finally {
                        console.warn = warn;
                      }
                      generateProject({
                        projectName: "sanity-app",
                        targetDir: app,
                        layers,
                        templateRoot: resolveTemplateRoot(),
                        overlayRoot: resolveOverlayRoot(),
                        force: true,
                      });
                      const env = await readFile(join(app, ".env.example"), "utf8"),
                        manifest = JSON.parse(await readFile(join(app, "package.json"), "utf8"));
                      expect(env).toContain(
                        `DB_CONNECTION=${database === "postgres" ? "pgsql" : database}`,
                      );
                      expect(env).toContain(`TENANCY_DRIVER=${tenancy}`);
                      expect(!!manifest.dependencies.mysql2).toBe(database === "mysql");
                      const cookie = auth.startsWith("cookie"),
                        users = auth !== "headers";
                      expect(existsSync(join(app, "src/models/User.ts"))).toBe(users);
                      expect(existsSync(join(app, "src/models/ApiToken.ts"))).toBe(
                        auth.includes("token"),
                      );
                      expect(existsSync(join(app, "frontend"))).toBe(
                        frontend === "spa-react" || frontend === "hybrid",
                      );
                      expect(env).toContain(`FEATURE_MFA=${extras && cookie}`);
                      expect(env).toContain(`FEATURE_EMAIL_VERIFICATION=${extras && users}`);
                      // Parse representative generated source per distinct core/extras shape. Infrastructure cross-product still checks env/Compose consistency.
                      if (cache === "array" && queue === "sync" && mail === "log")
                        for (const path of await files(app)) {
                          if (!/\.(ts|tsx)$/.test(path) || path.endsWith(".d.ts")) continue;
                          const content = await readFile(path, "utf8"),
                            transpiler = new Bun.Transpiler({
                              loader: extname(path) === ".tsx" ? "tsx" : "ts",
                            });
                          transpiler.transformSync(content);
                          parsed++;
                          for (const item of transpiler.scanImports(content))
                            if (item.path.startsWith(".")) {
                              const target = join(dirname(path), item.path);
                              expect(
                                ["", ".ts", ".tsx", ".js", ".css", "/index.ts", "/index.tsx"].some(
                                  (s) => existsSync(target + s),
                                ),
                                `Missing relative import ${path}: ${item.path}`,
                              ).toBe(true);
                            }
                        }
                      const compose = existsSync(join(app, "docker-compose.yml"))
                        ? await readFile(join(app, "docker-compose.yml"), "utf8")
                        : "";
                      for (const service of ["postgres", "mysql", "redis", "mailpit"]) {
                        const needed =
                          service === database ||
                          (service === "redis" && (cache === "redis" || queue === "redis")) ||
                          (service === "mailpit" && mail === "smtp");
                        expect(
                          new RegExp(`^  ${service}:`, "m").test(compose),
                          `${service} selection mismatch`,
                        ).toBe(needed);
                      }
                      cases++;
                    } catch (e) {
                      failures.push({ label, error: e instanceof Error ? e.message : String(e) });
                    }
                  }
    expect(failures).toEqual([]);
    expect(cases).toBe(2688);
    expect(parsed).toBeGreaterThan(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 120000);
