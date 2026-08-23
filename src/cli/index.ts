import { join } from "node:path";
import {
  configureModulesDirectory,
  ensureModulesLoaded,
} from "@getstrata/bootstrap/discoverModules";
import { runCli } from "@getstrata/cli";
import { commands } from "./register.ts";

configureModulesDirectory(join(import.meta.dir, "../modules"));
await ensureModulesLoaded();

await runCli({
  commands,
  skipBoot: true,
  exitProcess: true,
});
