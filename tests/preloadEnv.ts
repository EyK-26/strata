import { join } from "node:path";
import { configureModulesDirectory } from "../src/bootstrap/discoverModules.ts";

/**
 * Core tests pin Strata cookie names (`strata_session`, etc.).
 * HiroApp tests set HIROAPP_TEST=1 before Bun starts (package script + HiroApp preload).
 * Do not inherit APP_KEY_PREFIX=hiroapp from a local .env during core tests.
 */
const hiroapp = process.env.HIROAPP_TEST === "1";
if (hiroapp) {
  process.env.APP_KEY_PREFIX ??= "hiroapp";
  process.env.APP_NAME ??= "HiroApp";
} else {
  process.env.APP_KEY_PREFIX = "strata";
  process.env.APP_NAME ??= "Strata";
}

configureModulesDirectory(join(import.meta.dir, "fixtures/empty-modules"));
