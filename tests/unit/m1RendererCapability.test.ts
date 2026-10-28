import { expect, test } from "bun:test";
import { collectProviders } from "@getstrata/bootstrap/context";
import { startGuardedApplication } from "../../src/bootstrap/m1/application";

test("prepared document data cannot disguise an invalid underlying renderer capability", async () => {
  const providers = collectProviders([]).filter((provider) =>
    ["core.config", "core.cache", "core.storage", "core.auth", "core.policy"].includes(
      provider.name,
    ),
  );
  let app: Awaited<ReturnType<typeof startGuardedApplication>> | undefined;
  const pending = startGuardedApplication({
    providers,
    modules: [],
    documents: {} as never,
    artifacts: {
      manifest: {
        format: 1,
        buildId: "A",
        artifacts: {
          main: {
            relativePath: "entry.js",
            bytes: 0,
            mediaType: "text/javascript",
            integrity: `sha256-${Buffer.alloc(32).toString("base64")}`,
          },
        },
      },
      policy: { origin: "https://assets.example.test", releasePrefix: "/A/" },
      document: { buildId: "A", entryScripts: ["main"], windowModules: ["main"], stylesheets: [] },
    },
  }).then((result) => {
    app = result;
    return result;
  });
  try {
    await expect(pending).rejects.toThrow("invalid-document-capability");
  } finally {
    await app?.shutdown();
  }
});
