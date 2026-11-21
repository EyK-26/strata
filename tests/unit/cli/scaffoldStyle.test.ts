import { expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ESLint } from 'eslint';

import { scaffoldCommands } from '../../../packages/strata-cli/src/scaffold';

import { captureConsole } from './helpers';

const repoRoot = join(import.meta.dir, '../../..');

test('CLI scaffolds follow the application spacing and brace rules', async () => {
	const scenarios = [
		['make:model', 'Product'],
		['make:model', 'Inventory/Stock', '--primary-key=uuid', '--key-type=string'],
		['make:controller', 'Product'],
		['make:request', 'StoreProduct'],
		['make:policy', 'Product'],
		['make:migration', 'create_products'],
		['make:job', 'ImportProduct'],
		['make:listener', 'ProductChanged', 'product.updated'],
		['make:listener', 'ImportFinished', 'inventory.import.done'],
		['make:factory', 'Product'],
		['make:view', 'products/index'],
		['make:module', 'Warehouse'],
		['make:module', 'Catalog', '--with-web'],
		['make:factory', 'Catalog'],
	] as const;

	expect(new Set<string>(scenarios.map(([command]) => command))).toEqual(
		new Set(Object.keys(scaffoldCommands)),
	);

	const directory = await mkdtemp(join(tmpdir(), 'strata-scaffold-style-'));

	try {
		const previousCwd = process.cwd();

		const output = captureConsole();

		try {
			process.chdir(directory);

			for (const [command, ...args] of scenarios) {
				const load = scaffoldCommands[command];

				if (!load) {
					throw new Error(`Unknown scaffold command: ${command}`);
				}

				const run = await load();

				await run(...args);
			}
		} finally {
			process.chdir(previousCwd);
			output.restore();
		}

		const eslint = new ESLint({ cwd: repoRoot, fix: false });

		const lintDiagnostics: string[] = [];

		let lintedFiles = 0;

		async function visit(relative = ''): Promise<void> {
			for (const item of await readdir(join(directory, relative), { withFileTypes: true })) {
				const path = join(relative, item.name);

				if (item.isDirectory()) {
					await visit(path);
				} else if (/\.(?:[cm]?[jt]s|[jt]sx)$/.test(path)) {
					const [result] = await eslint.lintText(await readFile(join(directory, path), 'utf8'), {
						filePath: join(repoRoot, 'generated-scaffold', path),
					});

					if (!result) {
						throw new Error(`ESLint returned no result for ${path}`);
					}

					lintedFiles++;

					for (const message of result.messages) {
						lintDiagnostics.push(`${path}:${message.line}:${message.column} ${message.message}`);
					}
				}
			}
		}

		await visit();
		expect(lintedFiles).toBeGreaterThan(0);
		expect(lintDiagnostics).toEqual([]);
	} finally {
		await rm(directory, { recursive: true });
	}
});
