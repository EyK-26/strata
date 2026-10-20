import { expect, test } from "bun:test";
import { removeOwnedDockerContainers } from "../helpers/ownedDockerContainers";

async function docker(args: string[]): Promise<string> {
  const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`Docker fixture command failed: ${stderr}`);
  return stdout.trim();
}

function fixture() {
  const id = crypto.randomUUID().replaceAll("-", "");
  const first = `strata-cleanup-a-${id}`;
  const second = `strata-cleanup-b-${id}`;
  const volume = `strata-cleanup-${id}`;
  const mounts = new Set<string>();
  let namedVolumeCreated = false;

  return {
    first,
    second,
    volume,
    async createNamedVolume() {
      await docker(["docker", "volume", "create", volume]);
      namedVolumeCreated = true;
    },
    async create(name: string, args: string[] = []) {
      await docker(["docker", "create", "--name", name, ...args, "redis:7.4-alpine"]);
      const mounted = JSON.parse(
        await docker(["docker", "inspect", name, "--format", "{{json .Mounts}}"]),
      ) as Array<{ Type: string; Name?: string }>;
      for (const mount of mounted) {
        if (mount.Type === "volume" && mount.Name && mount.Name !== volume) mounts.add(mount.Name);
      }
      return mounted;
    },
    async cleanup() {
      const errors: unknown[] = [];
      for (const name of [first, second]) {
        try {
          const found = await docker([
            "docker",
            "container",
            "ls",
            "-aq",
            "--filter",
            `name=^/${name}$`,
          ]);
          if (found) await docker(["docker", "rm", "-fv", found]);
        } catch (error) {
          errors.push(error);
        }
      }
      // Captured mounts allow the red-test probe to clean up even after a faulty remover
      // has deleted its containers. Never discover ownership from global volume age/names.
      const remaining = new Set(
        (await docker(["docker", "volume", "ls", "--format", "{{.Name}}"])).split(/\s+/),
      );
      for (const name of [...mounts, ...(namedVolumeCreated ? [volume] : [])]) {
        try {
          if (remaining.has(name)) await docker(["docker", "volume", "rm", name]);
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, "Docker cleanup probe teardown failed.");
    },
  };
}

test("owned Docker cleanup removes anonymous mounts after partial setup and is repeatable", async () => {
  const owned = fixture();
  try {
    const mounts = await owned.create(owned.first);
    expect(mounts.some((mount) => mount.Type === "volume")).toBe(true);
    await removeOwnedDockerContainers(docker, [owned.first, owned.second]);
    await removeOwnedDockerContainers(docker, [owned.first, owned.second]);
    expect(
      await docker(["docker", "container", "ls", "-aq", "--filter", `name=^/${owned.first}$`]),
    ).toBe("");
  } finally {
    await owned.cleanup();
  }
}, 60000);

test("owned Docker cleanup preserves explicit named volumes and unrelated containers", async () => {
  const owned = fixture();
  try {
    await owned.createNamedVolume();
    await owned.create(owned.first, [
      "--mount",
      `type=volume,source=${owned.volume},target=/named`,
    ]);
    await owned.create(owned.second);
    await removeOwnedDockerContainers(docker, [owned.first], [owned.volume]);
    expect(
      await docker(["docker", "volume", "inspect", owned.volume, "--format", "{{.Name}}"]),
    ).toBe(owned.volume);
    expect(
      await docker(["docker", "container", "ls", "-aq", "--filter", `name=^/${owned.second}$`]),
    ).not.toBe("");
  } finally {
    await owned.cleanup();
  }
}, 60000);

test("owned Docker cleanup attempts every container when one removal fails", async () => {
  const owned = fixture();
  try {
    await owned.create(owned.first);
    await owned.create(owned.second);
    const firstId = await docker(["docker", "inspect", owned.first, "--format", "{{.Id}}"]);
    const failFirst = async (args: string[]) => {
      if (args[1] === "rm" && args.at(-1) === firstId)
        throw new Error("Injected container removal failure");
      return docker(args);
    };
    await expect(
      removeOwnedDockerContainers(failFirst, [owned.first, owned.second]),
    ).rejects.toThrow("Owned Docker container cleanup failed.");
    expect(
      await docker(["docker", "container", "ls", "-aq", "--filter", `name=^/${owned.second}$`]),
    ).toBe("");
    expect(
      await docker(["docker", "container", "ls", "-aq", "--filter", `name=^/${owned.first}$`]),
    ).not.toBe("");
    await removeOwnedDockerContainers(docker, [owned.first]);
  } finally {
    await owned.cleanup();
  }
}, 60000);
