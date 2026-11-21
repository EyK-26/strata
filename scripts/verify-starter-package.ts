/** Exercise each published CLI layout outside the repository, including its assets. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectSpawnOutput } from './bun-test-output';

const selected = process.argv[2];

assert.ok(
	selected === 'starter' || selected === 'create-strata',
	'Choose starter or create-strata',
);
const packageDirectory = join(
	import.meta.dir,
	'../packages',
	selected === 'starter' ? 'strata-starter' : selected,
);

const manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'));

const root = await mkdtemp(join(tmpdir(), 'strata-packaged-generator-'));

async function run(command: string[], cwd = root): Promise<string> {
	const child = Bun.spawn(command, {
		cwd,
		stdout: 'pipe',
		stderr: 'pipe',
		timeout: 60000,
	});

	const result = await collectSpawnOutput(child);

	assert.equal(result.exitCode, 0, `${command.join(' ')} failed:\n${result.output}`);

	return result.output;
}

try {
	const packed = await run(
		['npm', 'pack', '--silent', '--pack-destination', root],
		packageDirectory,
	);

	const archive = packed.trim().split('\n').at(-1);

	assert.ok(typeof archive === 'string' && archive.endsWith('.tgz'));
	await writeFile(
		join(root, 'package.json'),
		JSON.stringify({
			private: true,
			dependencies: { [manifest.name]: `file:${join(root, archive)}` },
		}),
	);
	await run([process.execPath, 'install', '--ignore-scripts']);
	const cli = join(root, 'node_modules/.bin/create-strata');

	assert.match(await run([process.execPath, cli, '--help']), /create-strata/);
	for (const frontend of ['api', 'hybrid']) {
		await run([
			process.execPath,
			cli,
			frontend,
			`--frontend=${frontend}`,
			'--database=sqlite',
			'--auth=cookie-token',
			'--yes',
			'--no-docker',
		]);
		const app = join(root, frontend);

		assert.ok(existsSync(join(app, 'tsconfig.json')), 'Base templates must be copied');
		assert.ok(existsSync(join(app, 'src/bootstrap/createApp.ts')), 'Application must be generated');
		const generated = JSON.parse(await readFile(join(app, 'package.json'), 'utf8'));

		assert.equal(generated.dependencies['@getstrata/core'], `^${manifest.version}`);
		const agents = await readFile(join(app, 'AGENTS.md'), 'utf8');

		assert.ok(agents.includes(`frontend=${frontend}; database=sqlite; auth=cookie-token;`));
		assert.ok(agents.includes('src/models/register.ts'));
		assert.ok(agents.includes('database.model(Product)'));
		assert.ok(!agents.includes('validate:host'));
		assert.equal(agents.includes('bun run frontend:build'), frontend === 'hybrid');

		if (frontend === 'hybrid') {
			assert.ok((await readFile(join(app, 'public/assets/htmx.min.js'))).length > 1000);
			assert.ok(existsSync(join(app, 'views/auth/login.eta')), 'Auth views must be generated');
		}
	}

	console.log(
		`PASS ${manifest.name}@${manifest.version}: packed CLI generates API and hybrid apps`,
	);
} finally {
	await rm(root, { recursive: true, force: true });
}
