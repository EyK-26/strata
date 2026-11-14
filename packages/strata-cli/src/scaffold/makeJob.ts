import { access } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { scaffoldArguments, writeScaffoldFile } from "./scaffoldFile";
import { toKebabCase, toPascalCase } from "./utils";

async function makeJobCommand(...args: string[]): Promise<void> {
  const parsed = scaffoldArguments("make:job", args);
  if (!parsed) return;
  const [name] = parsed;
  if (!name) {
    throw new Error("make:job requires a job name.");
  }

  const jobSlug = toKebabCase(name);
  const jobClass = `${toPascalCase(name)}Job`;
  const payloadType = `${toPascalCase(name)}Payload`;
  const directory = join(process.cwd(), "src", "jobs");
  const jobPath = join(directory, `${jobSlug}Job.ts`);

  try {
    await access(jobPath);
    throw new Error(`Job already exists: ${jobPath}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Job already exists:")) {
      throw error;
    }
  }

  const content = `import { Job } from "@getstrata/core/queue";

interface ${payloadType} {
}

class ${jobClass} extends Job<${payloadType}> {
  static readonly jobName = "${jobSlug}";

  override async handle(payload: ${payloadType}): Promise<void> {
    void payload;
  }
}

export default ${jobClass};
export type { ${payloadType} };
`;

  await writeScaffoldFile(relative(process.cwd(), jobPath).split(sep), content, "Job");

  console.log(`Created job in: ${jobPath}`);
  console.log(
    `Dispatch it via queue.dispatch(new ${jobClass}(), payload) from your controller or listener.`,
  );
  console.log(`Workers discover it from src/jobs/ as "${jobSlug}".`);
}

export { makeJobCommand };
