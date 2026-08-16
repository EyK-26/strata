import { join } from "node:path";
import {
  configureModulesDirectory,
  ensureModulesLoaded,
} from "@getstrata/bootstrap/discoverModules";

configureModulesDirectory(join(import.meta.dir, "../modules"));
await ensureModulesLoaded();
