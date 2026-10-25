import { scaffoldNameParts, writeScaffoldFile } from "./scaffoldFile";
import { toKebabCase, toPascalCase } from "./utils";

function modelIdentifier(value: string, option: string): string {
  if (
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ||
    ["__proto__", "prototype", "constructor"].includes(value)
  )
    throw new Error(`${option} must be a simple identifier.`);
  return value;
}

async function makeModelCommand(...args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Usage: strata make:model <Name|Group/Name> [--table=name] [--primary-key=id] [--key-type=number|string]",
    );
    console.log("Creates an id-only declarative model in src/models with an automatic repository.");
    console.log("No schema changes: run strata make:migration <name> separately.");
    return;
  }
  const names = args.filter((value) => !value.startsWith("--"));
  if (names.length > 1) throw new Error("make:model accepts one model name.");
  const parts = scaffoldNameParts(names[0], "make:model");
  const options = new Map<string, string>();
  for (const arg of args.filter((value) => value.startsWith("--"))) {
    const match = /^--(table|primary-key|key-type)=(.*)$/.exec(arg);
    if (!match?.[1] || options.has(match[1]))
      throw new Error(
        `Unsupported or duplicate make:model option: ${arg}; use --help. Migrations use make:migration separately.`,
      );
    options.set(match[1], match[2] ?? "");
  }
  if (["index", "register"].includes((parts.at(-1) ?? "").toLowerCase()))
    throw new Error("make:model name is reserved for model discovery orchestration.");
  const classParts = parts.map(toPascalCase);
  const className = classParts.join("");
  const key = modelIdentifier(options.get("primary-key") ?? "id", "--primary-key");
  const table = modelIdentifier(
    options.get("table") ?? `${parts.map(toKebabCase).join("_").replaceAll("-", "_")}s`,
    "--table",
  );
  const keyType = options.get("key-type") ?? "number";
  if (keyType !== "number" && keyType !== "string")
    throw new Error("--key-type must be number or string; UUID model keys use string.");
  const fillable = keyType === "string" ? JSON.stringify(key) : "";
  const content = `import { defineModel } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";

interface ${className}Record {
  ${key}: ${keyType};
}

const table = defineTable<${className}Record, "${key}">({
  name: "${table}",
  primaryKey: "${key}",
  columns: ["${key}"],
});

class ${className} extends defineModel(table) {
  // Add writable fields to the record, table columns and this explicit allowlist.
  static override $fillable = [${fillable}] as const;
  // Enable only after adding the corresponding timestamp columns to your schema.
  static override $timestamps = false;
}

export type { ${className}Record };
export { ${className} };
`;
  const path = await writeScaffoldFile(
    ["src", "models", ...classParts.slice(0, -1), `${classParts.at(-1)}.ts`],
    content,
    "Model",
  );
  console.log(`Created model: ${path}`);
  console.log(
    "src/models discovery supplies its default repository; no custom repository is required.",
  );
  console.log(
    `Next: strata make:migration create_${table}; define schema explicitly before strata migrate.`,
  );
}

export { makeModelCommand };
