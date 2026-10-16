import { join } from "node:path";
import {
  configureModulesDirectory,
  ensureModulesLoaded,
} from "@getstrata/bootstrap/discoverModules";
import { runCli } from "@getstrata/cli";
import { commands } from "./register.ts";

// This entrypoint belongs to the framework fixture harness, never a product app.
configureModulesDirectory(join(import.meta.dir, "../../tests/fixtures/empty-modules"));
await ensureModulesLoaded();

await runCli({
  commands,
  skipBoot: true,
  exitProcess: true,
});
