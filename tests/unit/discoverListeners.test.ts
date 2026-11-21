import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '../..');

const tempDirectories: string[] = [];

async function tempDir(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'strata-discover-listeners-'));

	tempDirectories.push(directory);

	return directory;
}

describe('discoverListeners', () => {
	afterEach(async () => {
		process.chdir(repoRoot);
		while (tempDirectories.length > 0) {
			const directory = tempDirectories.pop();

			if (directory) {
				await rm(directory, { recursive: true, force: true });
			}
		}
	});

	test('returns no declarations when src/listeners is absent', async () => {
		const { discoverListeners } = await import('../../src/bootstrap/discoverListeners');

		process.chdir(await tempDir());

		const listeners = await discoverListeners();

		expect(listeners).toEqual([]);
	});

	test('loads listeners from cwd on the first discoverListeners call', async () => {
		const root = await tempDir();

		const listenersDirectory = join(root, 'src', 'listeners');

		await mkdir(listenersDirectory, { recursive: true });
		await writeFile(
			join(listenersDirectory, 'sample.ts'),
			`export default Object.freeze({services:Object.freeze([]),repositoryEffects:Object.freeze([])});`,
		);

		process.chdir(repoRoot);
		await import('../../packages/strata-bootstrap/entries/discoverListeners.ts');

		process.chdir(root);
		const { discoverListeners } = await import('../../src/bootstrap/discoverListeners');

		const listeners = await discoverListeners();

		expect(listeners).toHaveLength(1);
		expect(listeners[0]?.services).toEqual([]);
		expect(listeners[0]?.repositoryEffects).toEqual([]);
		expect(Object.isFrozen(listeners[0])).toBe(true);
	});
});

test('event helper subscribes only during application lifetime and releases on stop', async () => {
	const { defineEventListener } = await import('../../src/bootstrap/discoverListeners');

	const { EventBus } = await import('@getstrata/core/events');

	const { APPLICATION_EVENT_BUS_TOKEN } = await import('../../src/bootstrap/providers/events');

	const { valueService } = await import('@getstrata/core/contracts/services');

	const { createApplication } = await import('@getstrata/core/runtime/application');

	const bus = new EventBus();

	const seen: unknown[] = [];

	const declarations = defineEventListener('order.paid', (payload) => {
		seen.push(payload);
	});

	const app = createApplication({
		providers: [],
		services: [valueService(APPLICATION_EVENT_BUS_TOKEN, bus), ...declarations.services],
	});

	await bus.emit('order.paid', 1);
	expect(seen).toEqual([]);
	await app.start();
	await bus.emit('order.paid', 2);
	expect(seen).toEqual([2]);
	await app.stop();
	await bus.emit('order.paid', 3);
	expect(seen).toEqual([2]);
});

test('model listeners attach to class and explicit repository writes after commit', async () => {
	const { defineModelListener } = await import('../../src/bootstrap/discoverListeners');

	const { defineModel, field } = await import('@getstrata/core/database/model');

	const { defineRepository } = await import('@getstrata/core/database/definitions');

	const { defineTable } = await import('@getstrata/core/database/table');

	const { BaseRepository } = await import('@getstrata/core/database/baseRepository');

	const { withBoundDatabase } = await import('../helpers/boundRepositoryHarness');

	class Contact extends defineModel({
		table: 'contacts',
		fields: { id: field.number(), name: field.string() },
	}) {
		static $fillable = ['name'] as const;
		static $timestamps = false;
	}

	const legacy = defineRepository({
		name: 'LegacyContact',
		table: defineTable<{ id: number; name: string }, 'id'>({
			name: 'contacts',
			primaryKey: 'id',
			columns: ['id', 'name'],
		}),
		dependencies: [] as const,
		create: (binding) => new BaseRepository(binding),
	});

	const classRows: string[] = [];

	const repositoryRows: string[] = [];

	const listeners = [
		defineModelListener(Contact, 'created', (row) => {
			classRows.push(row.name);
		}),
		defineModelListener(legacy, 'created', (row) => {
			repositoryRows.push(row.name);
		}),
	];

	await withBoundDatabase(
		{
			definition: {
				default: 'main',
				connections: { main: { driver: 'sqlite', filename: ':memory:' } },
				models: [Contact],
				repositories: [legacy],
				repositoryEffects: listeners.flatMap((listener) => listener.repositoryEffects),
			},
			services: listeners.flatMap((listener) => listener.services),
		},
		async (database) => {
			await database.execute({
				text: 'CREATE TABLE contacts (id INTEGER PRIMARY KEY, name TEXT NOT NULL)',
				params: [],
			});
			await database.model(Contact).create({ name: 'class' });
			await database.repository(legacy).create({ name: 'repository' });
			expect(classRows).toEqual(['class']);
			expect(repositoryRows).toEqual(['repository']);
		},
	);
});
