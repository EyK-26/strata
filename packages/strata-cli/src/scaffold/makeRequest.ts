import { scaffoldArguments, writeScaffoldFile } from "./scaffoldFile";
import { toPascalCase } from "./utils";

async function makeRequestCommand(...args: string[]): Promise<void> {
  const parsed = scaffoldArguments("make:request", args);
  if (!parsed) return;
  const [input] = parsed;
  if (!input) throw new Error("make:request requires a request name.");
  const parts = input.split("/").map(toPascalCase);
  const name = parts.at(-1) ?? "";
  const className = name.endsWith("Request") ? name : `${name}Request`;
  if (className === "FormRequest")
    throw new Error("make:request requires a specific request name, such as StoreNoteRequest.");
  const content = `import { FormRequest } from "@getstrata/core/http/formRequest";
import { maxLength, minLength, required, stringRule, validateObject } from "@getstrata/core/validation/rules";

interface ${className}Data {
  name: string;
}

class ${className} extends FormRequest<${className}Data> {
  protected parse(payload: unknown): ${className}Data {
    const data = validateObject(payload, {
      name: [required(), stringRule(), minLength(1), maxLength(120)],
    });
    return { name: data.name as string };
  }
}

export default ${className};
export type { ${className}Data };
`;
  const path = await writeScaffoldFile(
    ["src", "http", "requests", ...parts.slice(0, -1), `${className}.ts`],
    content,
    "Request",
  );
  console.log(`Created request: ${path}`);
  console.log(`Validate in a controller with await new ${className}().validate(request).`);
}

export { makeRequestCommand };
