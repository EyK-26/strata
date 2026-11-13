import { runCli } from "@getstrata/cli";
import { commands } from "./register.ts";

await runCli({
  commands,
  skipBoot: true,
  exitProcess: true,
});
