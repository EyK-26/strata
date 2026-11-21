import { scaffoldArguments, writeScaffoldFile } from './scaffoldFile';
import { toKebabCase, toPascalCase } from './utils';

async function makePolicyCommand(...args: string[]): Promise<void> {
	const parsed = scaffoldArguments('make:policy', args);

	if (!parsed) {
		return;
	}

	const [input] = parsed;

	if (!input) {
		throw new Error('make:policy requires a policy name.');
	}

	const parts = input.split('/').map(toPascalCase);

	const name = parts.at(-1) ?? '';

	const className = name.endsWith('Policy') ? name : `${name}Policy`;

	if (className === 'Policy') {
		throw new Error('make:policy requires a resource policy name, such as NotePolicy.');
	}

	const resource = toKebabCase(name.replace(/Policy$/, ''));

	const content = `import type { AuthUser } from "@getstrata/core/auth/authContext";
import { Policy } from "@getstrata/core/auth/policy";

class ${className} extends Policy {
  override view(_user: AuthUser | null, _resource: unknown): boolean {
    return true;
  }

  override create(_user: AuthUser | null): boolean {
    return false;
  }

  override update(_user: AuthUser | null, _resource: unknown): boolean {
    return false;
  }

  override delete(_user: AuthUser | null, _resource: unknown): boolean {
    return false;
  }
}

export default ${className};
`;

	const path = await writeScaffoldFile(
		['src', 'policies', ...parts.slice(0, -1), `${className}.ts`],
		content,
		'Policy',
	);

	console.log(`Created policy: ${path}`);
	console.log(
		`Register the policy in your application policy map: "${resource}": new ${className}().`,
	);
}

export { makePolicyCommand };
