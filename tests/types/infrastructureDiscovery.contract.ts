/** Compiled against packed public declarations in every generated-app/compiler combination. */
import { discoverJobs, type JobManifestEntry } from "@getstrata/bootstrap/discoverJobs";
import { discoverListeners } from "@getstrata/bootstrap/discoverListeners";
import { ensureModulesLoaded } from "@getstrata/bootstrap/discoverModules";
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
  const declarations = await discoverListeners({
    manifest: [{ services: [], repositoryEffects: [] }],
  });
  const immutableServices: readonly unknown[] = declarations[0]?.services ?? [];
  void immutableServices;
  // @ts-expect-error Listener discovery accepts inert declarations, never registrar effects.
  await discoverListeners({ manifest: [async () => {}] });
  await ensureModulesLoaded({
    manifest: [{ name: "app", providers: [{ name: "service", boot: async () => {} }] }],
  });
  // @ts-expect-error Discovery must complete before its names are available.
  const synchronous: string[] = discoverJobs();
  // @ts-expect-error A DI factory must return a framework job.
  const badFactory: JobManifestEntry = { name: "bad", create: () => 1 };
  void names;
  void synchronous;
  void badFactory;
}
