import { join } from "node:path";
import { configureModulesDirectory } from "../src/bootstrap/discoverModules.ts";

/**
 * Core tests keep WorkHub cookie/token fixtures (`workhub_session`, etc.).
 * HiroApp tests set HIROAPP_TEST=1 (or DOGFOOD_APP=hiroapp) in their own preload.
 * Runtime dogfood still defaults to HiroApp via readDogfoodApp().
 */
const hiroapp =
  process.env.HIROAPP_TEST === "1" ||
  (process.env.DOGFOOD_APP ?? "").trim().toLowerCase() === "hiroapp";
process.env.APP_KEY_PREFIX ??= hiroapp ? "hiroapp" : "workhub";
process.env.APP_NAME ??= hiroapp ? "HiroApp" : "WorkHub";

configureModulesDirectory(join(import.meta.dir, "fixtures/empty-modules"));
