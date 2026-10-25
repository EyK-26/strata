import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createGeneratedSecurityApp } from "../tests/helpers/generatedSecurityApp";

const fixture = await createGeneratedSecurityApp("sqlite", [
  "--auth=headers",
  "--tenancy=none",
  "--cache=array",
  "--queue=sync",
  "--mail=log",
  "--no-docker",
]);
try {
  const contract = await readFile(
    join(import.meta.dir, "../tests/helpers/mailDriverContract.ts"),
    "utf8",
  );
  await writeFile(
    join(fixture.app, "mail-contract.ts"),
    `${contract}\nconsole.log(JSON.stringify({ ...await verifyMailDelegation(), ...await verifyHttpMailExtension() }));\n`,
  );
  for (const args of [["mail-contract.ts"], ["run", "check"]]) {
    const proc = Bun.spawn([process.execPath, ...args], {
      cwd: fixture.app,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60000,
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    assert.equal(exit, 0, `${stdout}\n${stderr}`);
    if (args[0] === "mail-contract.ts") assert.match(stdout, /"wholeSendDeadline":true/);
  }
  console.log(JSON.stringify({ installedMailExtension: true }));
} finally {
  await fixture.close();
}
