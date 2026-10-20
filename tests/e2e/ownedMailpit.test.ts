import { expect, test } from "bun:test";
import { candidateMailpitPorts, MAILPIT_IMAGE, startOwnedMailpit } from "../helpers/ownedMailpit";

async function docker(args: string[]): Promise<string> {
  const child = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`Owned Docker command failed: ${err}`);
  return out.trim();
}

/** Keep probe teardown independent of the startup helper being tested. */
function ownedCommands() {
  const ids = new Set<string>();
  return {
    async run(args: string[]) {
      const out = await docker(args);
      if (args[0] === "create") ids.add(out);
      return out;
    },
    async close() {
      const remaining = new Set(
        (await docker(["container", "ls", "-aq", "--no-trunc"])).split(/\s+/),
      );
      const errors: unknown[] = [];
      for (const id of ids) {
        try {
          if (remaining.has(id)) await docker(["rm", "--force", "--volumes", id]);
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, "Mailpit probe teardown failed.");
    },
  };
}

async function occupiedDockerPorts() {
  const id = await docker([
    "run",
    "--detach",
    "--publish",
    "127.0.0.1::1025",
    "--publish",
    "127.0.0.1::8025",
    MAILPIT_IMAGE,
  ]);
  try {
    const bindings = JSON.parse(
      await docker(["inspect", id, "--format", "{{json .NetworkSettings.Ports}}"]),
    );
    return {
      id,
      smtpPort: Number(bindings["1025/tcp"][0].HostPort),
      httpPort: Number(bindings["8025/tcp"][0].HostPort),
      close: () => docker(["rm", "--force", "--volumes", id]),
    };
  } catch (error) {
    await docker(["rm", "--force", "--volumes", id]);
    throw error;
  }
}

test("owned Mailpit retries a real Docker port collision and preserves fixed endpoints on restart", async () => {
  const occupier = await occupiedDockerPorts();
  const owned = ownedCommands();
  const name = `strata-mailpit-retry-${crypto.randomUUID()}`;
  let mail: Awaited<ReturnType<typeof startOwnedMailpit>> | undefined;
  let allocations = 0;
  try {
    mail = await startOwnedMailpit(owned.run, name, async () => {
      allocations++;
      return allocations === 1 ? occupier : candidateMailpitPorts();
    });
    expect(mail.attempts).toBeGreaterThanOrEqual(2);
    expect(mail.attempts).toBe(allocations);
    expect(await docker(["inspect", occupier.id, "--format", "{{.State.Running}}"])).toBe("true");
    const initial = await docker([
      "inspect",
      mail.id,
      "--format",
      "{{json .NetworkSettings.Ports}}",
    ]);
    await docker(["stop", "--time", "1", mail.id]);
    await docker(["start", mail.id]);
    expect(await docker(["inspect", mail.id, "--format", "{{json .NetworkSettings.Ports}}"])).toBe(
      initial,
    );
    await mail.close();
    await mail.close();
    expect(await docker(["container", "ls", "-aq", "--filter", `name=^/${name}$`])).toBe("");
  } finally {
    try {
      await owned.close();
    } finally {
      await occupier.close();
    }
  }
}, 60000);

test("exhausted Mailpit port admission removes every failed owned container and preserves the occupier", async () => {
  const occupier = await occupiedDockerPorts();
  const owned = ownedCommands();
  const name = `strata-mailpit-exhaust-${crypto.randomUUID()}`;
  let allocations = 0;
  try {
    await expect(
      startOwnedMailpit(owned.run, name, async () => {
        allocations++;
        return occupier;
      }),
    ).rejects.toThrow("Owned Mailpit port allocation failed after 5 attempts.");
    expect(allocations).toBe(5);
    expect(await docker(["container", "ls", "-aq", "--filter", `name=^/${name}$`])).toBe("");
    expect(await docker(["inspect", occupier.id, "--format", "{{.State.Running}}"])).toBe("true");
  } finally {
    try {
      await owned.close();
    } finally {
      await occupier.close();
    }
  }
}, 60000);

test("non-port startup errors are not retried and their created container is removed", async () => {
  const name = `strata-mailpit-start-error-${crypto.randomUUID()}`;
  const failure = new Error("Injected Docker startup error");
  const owned = ownedCommands();
  let starts = 0;
  const failStart = async (args: string[]) => {
    if (args[0] === "start") {
      starts++;
      throw failure;
    }
    return owned.run(args);
  };
  try {
    await expect(startOwnedMailpit(failStart, name)).rejects.toBe(failure);
    expect(starts).toBe(1);
    expect(await docker(["container", "ls", "-aq", "--filter", `name=^/${name}$`])).toBe("");
  } finally {
    await owned.close();
  }
}, 60000);
