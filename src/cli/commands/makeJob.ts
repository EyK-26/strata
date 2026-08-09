import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { toKebabCase, toPascalCase } from "./utils";

async function makeJobCommand(name?: string): Promise<void> {
  if (!name) {
    throw new Error("make:job requires a job name.");
  }

  const jobSlug = toKebabCase(name);
  const jobClass = `${toPascalCase(name)}Job`;
  const payloadType = `${toPascalCase(name)}Payload`;
  const directory = join(process.cwd(), "src", "jobs");
  const jobPath = join(directory, `${jobSlug}Job.ts`);

  await mkdir(directory, { recursive: true });

  try {
    await access(jobPath);
    throw new Error(`Job already exists: ${jobPath}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Job already exists:")) {
      throw error;
    }
  }

  const content = `import { Job } from "../core/queue";

interface ${payloadType} {
}

class ${jobClass} extends Job<${payloadType}> {
  override async handle(payload: ${payloadType}): Promise<void> {
    void payload;
  }
}

export default ${jobClass};
export type { ${payloadType} };
`;

  await Bun.write(jobPath, content);

  console.log(`Created job in: ${jobPath}`);
  console.log(
    `Dispatch it via queue.dispatch(new ${jobClass}(), payload) from your controller or listener.`,
  );
}

export { makeJobCommand };
