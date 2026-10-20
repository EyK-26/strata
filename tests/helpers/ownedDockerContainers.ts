import assert from "node:assert/strict";

type DockerCommand = (args: string[]) => Promise<string>;
type DockerMount = { Type: string; Name?: string };

/** Names and explicit named volumes must belong to this fixture invocation. */
async function removeOwnedDockerContainers(
  run: DockerCommand,
  names: readonly string[],
  preservedVolumes: readonly string[] = [],
): Promise<void> {
  const anonymousVolumes = new Set<string>();
  const preserved = new Set(preservedVolumes);
  const errors: unknown[] = [];

  for (const name of names) {
    try {
      assert.match(name, /^[A-Za-z0-9][A-Za-z0-9_.-]*$/, "Invalid owned container name");
      const exactName = name.replaceAll(".", "\\.");
      const id = await run([
        "docker",
        "container",
        "ls",
        "-aq",
        "--no-trunc",
        "--filter",
        `name=^/${exactName}$`,
      ]);
      if (!id) continue;
      const mounts = JSON.parse(
        await run(["docker", "inspect", id, "--format", "{{json .Mounts}}"]),
      ) as DockerMount[];
      for (const mount of mounts) {
        if (mount.Type === "volume" && mount.Name && !preserved.has(mount.Name)) {
          anonymousVolumes.add(mount.Name);
        }
      }
      await run(["docker", "rm", "-f", "--volumes", id]);
    } catch (error) {
      errors.push(error);
    }
  }

  try {
    const remaining = new Set(
      (await run(["docker", "volume", "ls", "--format", "{{.Name}}"])).split(/\s+/),
    );
    for (const name of anonymousVolumes) {
      assert.ok(!remaining.has(name), "An owned anonymous Docker volume survived cleanup");
    }
  } catch (error) {
    errors.push(error);
  }
  if (errors.length) throw new AggregateError(errors, "Owned Docker container cleanup failed.");
}

export { removeOwnedDockerContainers };
