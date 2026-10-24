/** Shared installation of the normal module used by opt-in and mandatory startup probes. */
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
export const STARTUP_PROBE_OPTIONS = [
  "--frontend=api",
  "--auth=headers",
  "--tenancy=none",
  "--cache=array",
  "--queue=sync",
  "--mail=log",
  "--no-mfa",
  "--no-email-verification",
  "--no-scim",
  "--no-metrics",
  "--no-docker",
];
export async function installStartupProbe(app: string) {
  const target = join(app, "src/qualification");
  await mkdir(target, { recursive: true });
  const source = join(import.meta.dir, "../../scripts/fixtures/m1-startup");
  for (const name of ["consumer.ts", "module.ts", "state.ts", "types.ts"])
    await copyFile(join(source, name), join(target, name));
  const directory = join(app, "src/modules/owned-startup-probe");
  await mkdir(directory);
  await writeFile(
    join(directory, "index.ts"),
    'export { default } from "../../qualification/module.ts";\n',
    { flag: "wx" },
  );
  return target;
}
