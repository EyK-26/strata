import { join } from "node:path";
import { configureModulesDirectory, ensureModulesLoaded } from "./discoverModules.ts";

configureModulesDirectory(join(import.meta.dir, "../../apps/hiroapp/src/modules"));
await ensureModulesLoaded();
