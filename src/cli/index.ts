import { join } from "node:path";
import {
  configureModulesDirectory,
  ensureModulesLoaded,
} from "@getstrata/bootstrap/discoverModules";
import { runCli } from "@getstrata/cli";
import { readDogfoodApp } from "../bootstrap/dogfoodApp.ts";
import { commands } from "./register.ts";

configureModulesDirectory(
  readDogfoodApp() === "hiroapp"
    ? join(import.meta.dir, "../../apps/hiroapp/src/modules")
    : join(import.meta.dir, "../modules"),
);
await ensureModulesLoaded();

await runCli({
  commands,
  skipBoot: true,
  exitProcess: true,
});
