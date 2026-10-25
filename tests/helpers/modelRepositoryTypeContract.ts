import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Compile unsuppressed negative consumers separately from the valid generated project. */
async function verifyModelRepositoryRejections(app: string): Promise<void> {
  const cases: { code: string; diagnostic: string }[] = [];
  for (const generic of ["", "<LeadRecord, 'id'>"]) {
    const repository = `Lead.repository${generic}()`;
    cases.push(
      {
        code: `${repository}.upsert({id:'id',email:'fixture@example.test',attempts:0},['missing'],['email']);`,
        diagnostic: "TS2322",
      },
      {
        code: `${repository}.upsert({id:'id',email:'fixture@example.test',attempts:0},['email'],['missing']);`,
        diagnostic: "TS2322",
      },
      {
        code: `${repository}.upsert({id:'id',email:1,attempts:0},['email'],['email']);`,
        diagnostic: "TS2322",
      },
      {
        code: `${repository}.upsert({id:'id',email:'fixture@example.test',attempts:'wrong'},['email'],['email']);`,
        diagnostic: "TS2322",
      },
      {
        code: `${repository}.upsert({id:'id',email:'fixture@example.test',attempts:0},['email'],['email']).then(row=>row?.missing);`,
        diagnostic: "TS2339",
      },
    );
  }
  cases.push(
    { code: "Lead.repository().findById(123);", diagnostic: "TS2345" },
    { code: "Stock.repository().findById(123);", diagnostic: "TS2345" },
    { code: 'Lead.repository<LeadRecord,"missing">();', diagnostic: "TS2344" },
  );
  const file = join(app, "src/model-repository-negative.ts");
  const header = 'import {Lead, Stock, type LeadRecord} from "./model-repository.contract";\n';
  await writeFile(file, `${header}${cases.map((x) => x.code).join("\n")}\n`);
  try {
    const p = Bun.spawn([process.execPath, "x", "--no-install", "tsc", "--noEmit"], {
      cwd: app,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60000,
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    const output = Bun.stripANSI(stdout + stderr);
    assert.notEqual(exit, 0, "Invalid repository calls unexpectedly typechecked");
    const diagnostics = [
      ...output.matchAll(/src\/model-repository-negative\.ts\((\d+),\d+\): error (TS\d+):/g),
    ];
    assert.equal(diagnostics.length, cases.length, output);
    assert.equal((output.match(/error TS\d+:/g) ?? []).length, cases.length, output);
    for (const [index, item] of cases.entries()) {
      const diagnostic = diagnostics.find((x) => Number(x[1]) === index + 2);
      assert.ok(diagnostic, `Missing negative control at line ${index + 2}: ${output}`);
      assert.equal(diagnostic[2], item.diagnostic, output);
    }
  } finally {
    await rm(file, { force: true });
  }
}

export { verifyModelRepositoryRejections };
