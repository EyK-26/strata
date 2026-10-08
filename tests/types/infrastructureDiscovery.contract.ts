/** Compiled against packed public declarations in every generated-app/compiler combination. */
import { discoverJobs, type JobManifestEntry } from "@getstrata/bootstrap/discoverJobs";
import { discoverListeners } from "@getstrata/bootstrap/discoverListeners";
import {
  configureModulesManifest,
  ensureModulesLoaded,
} from "@getstrata/bootstrap/discoverModules";
import { Job } from "@getstrata/core/queue";

class Declared extends Job {
  static override jobName = "declared";
  async handle(): Promise<void> {}
}
export async function infrastructureContract(): Promise<void> {
  const manifest: readonly JobManifestEntry[] = [
    Declared,
    { name: "injected", create: () => new Declared() },
  ];
  const names: string[] = await discoverJobs({ manifest });
  const registrars = await discoverListeners({ manifest: [async () => {}] });
  await registrars[0]?.();
  configureModulesManifest([
    { name: "app", providers: [{ name: "service", boot: async () => {} }] },
  ]);
  await ensureModulesLoaded();
  // @ts-expect-error Discovery must complete before its names are available.
  const synchronous: string[] = discoverJobs();
  // @ts-expect-error A DI factory must return a framework job.
  const badFactory: JobManifestEntry = { name: "bad", create: () => 1 };
  void names;
  void synchronous;
  void badFactory;
}
