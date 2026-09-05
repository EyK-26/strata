import { join } from "node:path";
import { configureModulesDirectory } from "../src/bootstrap/discoverModules.ts";

/**
 * Core tests pin Strata cookie names (`strata_session`, etc.).
 * HiroApp tests set HIROAPP_TEST=1 in their own preload.
 */
const hiroapp =
  process.env.HIROAPP_TEST === "1" ||
  (process.env.DOGFOOD_APP ?? "").trim().toLowerCase() === "hiroapp";
process.env.APP_KEY_PREFIX ??= hiroapp ? "hiroapp" : "strata";
process.env.APP_NAME ??= hiroapp ? "HiroApp" : "Strata";

configureModulesDirectory(join(import.meta.dir, "fixtures/empty-modules"));
