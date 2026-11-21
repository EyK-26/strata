import { scaffoldArguments, writeScaffoldFile } from './scaffoldFile';
import { toPascalCase } from './utils';

async function makeControllerCommand(...args: string[]): Promise<void> {
	const parsed = scaffoldArguments('make:controller', args);

	if (!parsed) {
		return;
	}

	const [input] = parsed;

	if (!input) {
		throw new Error('make:controller requires a controller name.');
	}

	const parts = input.split('/').map(toPascalCase);

	const name = parts.at(-1) ?? '';

	const className = name.endsWith('Controller') ? name : `${name}Controller`;

	const content = `import { jsonResponse } from "@getstrata/core/http/response";

class ${className} {
  index(_request: Request): Response {
    return jsonResponse({ message: "${className}" });
  }
}

export { ${className} };
`;

	const path = await writeScaffoldFile(
		['src', 'http', 'controllers', ...parts.slice(0, -1), `${className}.ts`],
		content,
		'Controller',
	);

	console.log(`Created controller: ${path}`);
	console.log('Register its methods in src/routes/web.ts or src/routes/api.ts.');
	console.log('Resolve request-scoped dependencies inside the route callback.');
}

export { makeControllerCommand };
