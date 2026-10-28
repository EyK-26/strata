import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidatePackage } from "../../scripts/candidate-packages";

test("installed M1 reuses the public context owner and restores it after native shutdown", async () => {
  const directory = await mkdtemp(join(tmpdir(), "strata-m1-packed-context-"));
  try {
    const core = await candidatePackage("core", directory);
    const bootstrap = await candidatePackage("bootstrap", directory);
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({
        name: "strata-m1-context-contract",
        private: true,
        type: "module",
        dependencies: {
          "@getstrata/core": `file:${core}`,
          "@getstrata/bootstrap": `file:${bootstrap}`,
        },
      }),
    );
    await writeFile(
      join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ESNext",
          module: "preserve",
          moduleResolution: "bundler",
          strict: true,
        },
      }),
    );
    await writeFile(
      join(directory, "consumer.ts"),
      await readFile(join(import.meta.dir, "../fixtures/m1PackedContext.ts")),
    );
    await writeFile(
      join(directory, "startup-cleanup.ts"),
      await readFile(join(import.meta.dir, "../fixtures/m1PackedStartupCleanup.ts")),
    );
    await writeFile(
      join(directory, "exports.ts"),
      await readFile(join(import.meta.dir, "../fixtures/m1PackedExports.ts")),
    );
    for (const args of [
      ["install", "--ignore-scripts", "--no-save"],
      ["--no-env-file", "run", "consumer.ts"],
      ["--no-env-file", "run", "exports.ts"],
      ...[
        "timely-failure",
        "late-success",
        "ignored-late-failure",
        "metadata-conflict",
        "never-settling",
      ].map((mode) => ["--no-env-file", "run", "startup-cleanup.ts", mode]),
    ]) {
      const child = Bun.spawn([process.execPath, ...args], {
        cwd: directory,
        env: { ...process.env, BUN_INSTALL_CACHE_DIR: join(directory, "owned-cache") },
        stdout: "pipe",
        stderr: "pipe",
        timeout: args.includes("startup-cleanup.ts") ? 15_000 : 90_000,
        killSignal: "SIGTERM",
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(code, `${args.join(" ")}\n${stdout}\n${stderr}`).toBe(0);
      if (args.includes("startup-cleanup.ts")) {
        const receipt = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}");
        expect(receipt.mode).toBe(args.at(-1));
        expect(receipt.passed).toBe(true);
        console.log(JSON.stringify({ contract: "packed-m1-startup-cleanup", ...receipt }));
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 200_000);
