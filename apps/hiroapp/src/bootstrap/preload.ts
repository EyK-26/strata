import { join } from "node:path";
import { configureModulesDirectory } from "@getstrata/bootstrap/discoverModules";
import { ensureHiroappDatabase } from "../db/ensureDatabase.ts";

process.env.APP_KEY_PREFIX ??= "hiroapp";
process.env.APP_NAME ??= "HiroApp";
await ensureHiroappDatabase();
configureModulesDirectory(join(import.meta.dir, "../modules"));
