import { access } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { renderModuleScaffold } from './renderModule';
import { renderRlsModuleScaffold } from './renderRlsModule';
import { scaffoldArguments, writeScaffoldFile, writeScaffoldFiles } from './scaffoldFile';
import {
	migrationDirectory,
	moduleDirectory,
	timestampForFilename,
	toCamelCase,
	toKebabCase,
	toPascalCase,
	webViewsDirectory,
} from './utils';

async function writeModuleFiles(directory: string, files: ReadonlyMap<string, string>) {
	for (const [fileName, content] of files) {
		await writeScaffoldFile(
			relative(process.cwd(), join(directory, fileName)).split(sep),
			content,
			'Module file',
		);
	}
}

async function makeModuleCommand(...args: string[]): Promise<void> {
	const parsed = scaffoldArguments('make:module', args, ['--with-web', '--rls']);

	if (!parsed) {
		return;
	}

	const withWeb = args.includes('--with-web');

	const withRls = args.includes('--rls');

	if (withRls && withWeb) {
		throw new Error('make:module --rls is API-only and cannot be combined with --with-web.');
	}

	const [name] = parsed;

	if (!name) {
		throw new Error('make:module requires a name.');
	}

	const moduleSlug = toKebabCase(name);

	const moduleName = toPascalCase(name);

	const moduleIdentifier = toCamelCase(name);

	if (!moduleName || !moduleIdentifier || !moduleSlug) {
		throw new Error('make:module requires a valid module name.');
	}

	// Inspect the generated app's inert choices without importing its bootstrap graph.
	const choicesPath = join(process.cwd(), 'src', 'config', 'app.ts');

	const choices = (await Bun.file(choicesPath).exists())
		? ((await import(pathToFileURL(choicesPath).href)).default as
				| { views?: boolean; tenancy?: string }
				| undefined)
		: undefined;

	if (withWeb && choices?.views === false) {
		throw new Error(
			'make:module --with-web requires a configured server view renderer. This app disabled views; use make:module without --with-web or configure views first.',
		);
	}

	if (withRls && choices?.tenancy !== 'rls') {
		throw new Error('make:module --rls requires an app configured for PostgreSQL RLS.');
	}

	if (!withRls && (choices?.tenancy === 'column' || choices?.tenancy === 'rls')) {
		throw new Error(
			`make:module CRUD does not implement ${choices.tenancy} tenancy. Use make:model, make:controller and make:request to implement trusted tenant scoping and schema explicitly.`,
		);
	}

	const directory = await moduleDirectory(moduleSlug);

	try {
		await access(directory);
		throw new Error(`Module already exists: ${directory}`);
	} catch (error) {
		if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
			if (error instanceof Error && error.message.startsWith('Module already exists:')) {
				throw error;
			}

			throw error;
		}
	}

	const options = {
		moduleSlug,
		moduleName,
		moduleIdentifier,
		withWeb,
	};

	if (withRls) {
		const migrationName = `${timestampForFilename()}_create_${moduleSlug.replaceAll('-', '_')}`;

		const { files, migration } = renderRlsModuleScaffold(options, migrationName);

		const migrationFile = join(migrationDirectory(), `${migrationName}.ts`);

		await writeScaffoldFiles([
			...Array.from(files, ([fileName, content]) => ({
				segments: relative(process.cwd(), join(directory, fileName)).split(sep),
				content,
				label: 'Module file',
			})),
			{
				segments: relative(process.cwd(), migrationFile).split(sep),
				content: migration,
				label: 'Migration',
			},
		]);
		console.log(`Created RLS module scaffold in: ${directory}`);
		console.log(`Created migration: ${migrationFile}`);
		console.log('Review the migration, register the model, and configure abilities and the resource policy.');

		return;
	}

	const { files, webFiles, viewFiles, pluralSlug } = renderModuleScaffold(options);

	await writeModuleFiles(directory, files);

	let createdViewsDirectory: string | undefined;

	if (withWeb) {
		const viewsDirectory = webViewsDirectory(pluralSlug);

		createdViewsDirectory = viewsDirectory;
		for (const [fileName, content] of viewFiles) {
			await writeScaffoldFile(
				relative(process.cwd(), join(viewsDirectory, fileName)).split(sep),
				content,
				'Module view',
			);
		}

		await writeModuleFiles(directory, webFiles);
	}

	console.log(`Created module scaffold in: ${directory}`);

	if (createdViewsDirectory) {
		const relativeViews = createdViewsDirectory.startsWith(process.cwd())
			? createdViewsDirectory.slice(process.cwd().length + 1)
			: createdViewsDirectory;

		console.log(`Created web view scaffold in: ${relativeViews}/`);
		console.log(`API routes use API_PREFIX (default /api/v1); HTML collection: /${pluralSlug}`);
	}

	console.log(`Module will be auto-discovered from the app modules directory (${moduleSlug}/)`);
	console.log(`Next: strata make:migration create_${moduleSlug} && strata migrate`);

	console.log(
		'Add the generated model class to src/models/register.ts modelDefinitions (passed to defineApp({ models })).',
	);
}

export { makeModuleCommand };
