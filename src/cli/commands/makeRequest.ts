import { join } from "node:path";
import { ensureDirectory, moduleDirectory, toKebabCase, toPascalCase } from "./utils";

async function makeRequestCommand(moduleName?: string): Promise<void> {
  if (!moduleName) {
    throw new Error("make:request requires a module name.");
  }

  const moduleSlug = toKebabCase(moduleName);
  const moduleNamePascal = toPascalCase(moduleName);
  const filePath = join(moduleDirectory(moduleSlug), "requests.ts");

  await ensureDirectory(moduleDirectory(moduleSlug));

  const exists = await Bun.file(filePath).exists();
  if (exists) {
    throw new Error(`Request file already exists: ${filePath}`);
  }

  const content = `import {
  FormRequest,
  parsePositiveIntParam,
} from "../../core/http";
import {
  maxLength,
  minLength,
  required,
  stringRule,
  validateObject,
} from "../../core/validation/rules";

type ${moduleNamePascal}IdParams = { id: string };

interface Create${moduleNamePascal}BodyDto {
  name: string;
}

class Create${moduleNamePascal}Request extends FormRequest<Create${moduleNamePascal}BodyDto> {
  protected parse(payload: unknown): Create${moduleNamePascal}BodyDto {
    const validated = validateObject(payload, {
      name: [required(), stringRule(), minLength(1), maxLength(120)],
    });

    return {
      name: validated.name as string,
    };
  }
}

const create${moduleNamePascal}Request = new Create${moduleNamePascal}Request();

function parse${moduleNamePascal}IdParams(params: ${moduleNamePascal}IdParams): { id: number } {
  return {
    id: parsePositiveIntParam(params.id, "${moduleSlug} id"),
  };
}

async function parseCreate${moduleNamePascal}Body(
  request: Request,
): Promise<Create${moduleNamePascal}BodyDto> {
  return await create${moduleNamePascal}Request.validate(request);
}

export { parseCreate${moduleNamePascal}Body, parse${moduleNamePascal}IdParams };
export type { Create${moduleNamePascal}BodyDto, ${moduleNamePascal}IdParams };
`;

  await Bun.write(filePath, content);
  console.log(`Created request helpers: ${filePath}`);
}

export { makeRequestCommand };
