import assert from "node:assert/strict";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const marker = process.env.STRATA_CHILD_OWNERSHIP_MARKER;
assert.ok(marker, "Fixture environment must reach the actual child");
assert.equal(process.env.STRATA_CHILD_PRELOAD_MARKER, marker, "Child preload did not run");
const core = import.meta.resolve("@getstrata/core/runtime/application");
assert.ok(core.includes("/node_modules/@getstrata/core/"), "Child resolved a source alias");
let first: string | undefined;
const keepAlive = setInterval(() => {}, 1000);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (first) return;
    first = signal;
    void (async () => {
      await Bun.sleep(50);
      await writeFile(
        join(process.cwd(), "drained.json"),
        JSON.stringify({ signal, pid: process.pid }),
      );
      clearInterval(keepAlive);
      process.exit(7);
    })();
  });
}
console.log(`child-stdout:${marker}`);
console.error(`child-stderr:${marker}`);
await writeFile(
  join(process.cwd(), "ready.tmp"),
  JSON.stringify({
    pid: process.pid,
    cwd: process.cwd(),
    argv: process.argv.slice(2),
    marker,
    preload: process.env.STRATA_CHILD_PRELOAD_MARKER,
    core,
  }),
);
await rename(join(process.cwd(), "ready.tmp"), join(process.cwd(), "ready.json"));
