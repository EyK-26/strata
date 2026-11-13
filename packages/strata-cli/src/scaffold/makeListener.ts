import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { toCamelCase, toKebabCase, toPascalCase } from "./utils";

async function makeListenerCommand(name?: string, eventName?: string): Promise<void> {
  if (!name) {
    throw new Error("make:listener requires a listener name.");
  }

  const listenerSlug = toKebabCase(name);
  const listenerToken = `${toPascalCase(name)}Listener`;
  const directory = join(process.cwd(), "src", "listeners");
  const listenerPath = join(directory, `${listenerSlug}.ts`);
  const resolvedEventName = eventName ?? `${toCamelCase(name)}.created`;

  await mkdir(directory, { recursive: true });

  try {
    await access(listenerPath);
    throw new Error(`Listener already exists: ${listenerPath}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Listener already exists:")) {
      throw error;
    }
  }

  const [table, action, ...extra] = resolvedEventName.split(".");
  const modelEvent =
    extra.length === 0 &&
    ["created", "updated", "deleted", "restored", "force-deleted"].includes(action ?? "");
  const modelName = toPascalCase((table ?? name).replace(/s$/, ""));
  const content = modelEvent
    ? `import { service } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { repositoryEffects, type AfterCommitRepositoryListener } from "@getstrata/core/database/definitions";
import { ${modelName}Repository, type ${modelName}Record } from "../models/${modelName}.ts";
import type { ListenerDeclarations } from "@getstrata/bootstrap/discoverListeners";

const ${listenerToken}=createServiceToken<AfterCommitRepositoryListener<${modelName}Record>>(${JSON.stringify(resolvedEventName)});
const declarations:ListenerDeclarations=Object.freeze({
  services:Object.freeze([service(${listenerToken},{lifetime:"application",dependencies:[] as const,create:()=>async(row)=>{void row;}})]),
  repositoryEffects:Object.freeze([repositoryEffects(${modelName}Repository,[{action:${JSON.stringify(action)},afterCommit:${listenerToken}}])]),
});
export default declarations;
`
    : `import { resourceService } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { APPLICATION_EVENT_BUS_TOKEN } from "@getstrata/bootstrap/providers/events";
import type { ListenerDeclarations } from "@getstrata/bootstrap/discoverListeners";

const ${listenerToken}=createServiceToken<()=>void>(${JSON.stringify(resolvedEventName)});
const declarations:ListenerDeclarations=Object.freeze({repositoryEffects:Object.freeze([]),services:Object.freeze([
  resourceService(${listenerToken},{lifetime:"application",dependencies:[APPLICATION_EVENT_BUS_TOKEN] as const,create:bus=>({
    name:${JSON.stringify(resolvedEventName)},open:()=>({ok:true,value:bus.listen(${JSON.stringify(resolvedEventName)},async payload=>{void payload;})}),close:unsubscribe=>unsubscribe(),
  })}),
])});
export default declarations;
`;

  await Bun.write(listenerPath, content);

  console.log(`Created listener in: ${listenerPath}`);
  console.log(`Listening for event: ${resolvedEventName}`);
  console.log("It will be auto-discovered from src/listeners/ on the next app boot.");
}

export { makeListenerCommand };
