import { join } from "node:path";
import { configureModulesDirectory } from "../src/bootstrap/discoverModules.ts";

/** Core tests pin framework cookie names independently of a contributor's local .env. */
process.env.APP_KEY_PREFIX = "strata";
process.env.APP_NAME ??= "Strata";

configureModulesDirectory(join(import.meta.dir, "fixtures/empty-modules"));
