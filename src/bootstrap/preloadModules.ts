import { join } from "node:path";
import { configureModulesDirectory, ensureModulesLoaded } from "./discoverModules.ts";
import { readDogfoodApp } from "./dogfoodApp.ts";

const app = readDogfoodApp();
configureModulesDirectory(
  app === "hiroapp"
    ? join(import.meta.dir, "../../apps/hiroapp/src/modules")
    : join(import.meta.dir, "../modules"),
);
await ensureModulesLoaded();
