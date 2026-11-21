import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { candidatePackage } from '../../scripts/candidate-packages';

test('installed model field exports retain strict authoring and repository types', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'strata-model-field-types-'));

	const root = join(import.meta.dir, '../..');

	try {
		const archive = await candidatePackage('core', directory);

		const dependencies: Record<string, string> = { '@getstrata/core': `file:${archive}` };

		for (const name of ['eta', 'mysql2', '@node-saml/node-saml', 'typescript', '@types/bun']) {
			const manifest = JSON.parse(
				await readFile(join(root, 'node_modules', name, 'package.json'), 'utf8'),
			);

			dependencies[name] = manifest.version;
		}

		await writeFile(
			join(directory, 'package.json'),
			JSON.stringify({ private: true, type: 'module', dependencies }),
		);
		async function run(args: string[]) {
			const child = Bun.spawn(args, {
				cwd: directory,
				env: process.env,
				stdout: 'pipe',
				stderr: 'pipe',
				timeout: 120000,
				killSignal: 'SIGTERM',
			});

			const [stdout, stderr, exit] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				child.exited,
			]);

			return { exit, output: stdout + stderr };
		}

		const install = await run([process.execPath, 'install', '--ignore-scripts']);

		assert.equal(install.exit, 0, install.output);
		const installed = join(directory, 'node_modules/@getstrata/core');

		assert.equal(
			await realpath(installed),
			installed,
			'Use an installed archive, not a workspace alias.',
		);
		await copyFile(
			join(root, 'tests/fixtures/modelFieldTypesConsumer.ts'),
			join(directory, 'consumer.ts'),
		);
		await writeFile(
			join(directory, 'tsconfig.json'),
			JSON.stringify({
				compilerOptions: {
					target: 'ESNext',
					module: 'Preserve',
					moduleResolution: 'bundler',
					strict: true,
					noEmit: true,
					skipLibCheck: true,
					types: ['bun'],
					allowImportingTsExtensions: true,
				},
				include: ['consumer.ts'],
			}),
		);
		const command = [
			process.execPath,
			join(directory, 'node_modules/typescript/bin/tsc'),
			'--noEmit',
		];

		const checked = await run(command);

		assert.equal(checked.exit, 0, checked.output);

		const contract = await readFile(join(directory, 'consumer.ts'), 'utf8');

		await writeFile(
			join(directory, 'consumer.ts'),
			contract.replaceAll('@ts-expect-error', 'negative-control'),
		);
		const rejected = await run(command);

		assert.notEqual(
			rejected.exit,
			0,
			'The compiler must reject the invalid field/class/state operations.',
		);
		assert.match(rejected.output, /ModelField<string>/);
		assert.match(rejected.output, /refunded/);
		assert.match(rejected.output, /reference/);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}, 180000);
