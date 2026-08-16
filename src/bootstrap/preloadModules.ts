import { join } from "node:path";
import { configureModulesDirectory, ensureModulesLoaded } from "./discoverModules.ts";

configureModulesDirectory(join(import.meta.dir, "../modules"));
await ensureModulesLoaded();
