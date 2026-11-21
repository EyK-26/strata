import { describe, expect, test } from 'bun:test';

import { valueService } from '@getstrata/core/contracts/services';
import { createServiceToken } from '@getstrata/core/contracts/token';
import { createDatabaseBindings } from '@getstrata/core/database/bindings';
import type { AfterCommitRepositoryListener } from '@getstrata/core/database/definitions';
import {
	defineModel,
	field,
	type ModelAttributes,
	modelEffects,
	modelTable,
} from '@getstrata/core/database/model';
import type { DatabaseSession } from '@getstrata/core/database/session';

import { createClassModelDefinition } from '../../../src/core/database/modelAuthoring';
import { withBoundDatabase } from '../../helpers/boundRepositoryHarness';

class Category extends defineModel({
	table: 'authoring_categories',
	fields: { id: field.number(), name: field.string() },
}) {
	static $fillable = ['name'] as const;
	static $timestamps = false;
	displayName() {
		return this.get('name').toUpperCase();
	}
	notes() {
		return this.hasMany(() => Note, 'category_id');
	}
}

class Note extends defineModel({
	table: 'authoring_notes',
	fields: {
		id: field.number(),
		category_id: field.nullable(field.number()),
		body: field.string(),
		metadata: field.json<{ tags: string[] }>(),
		created_at: field.timestamp(),
	},
	defaultOrderBy: { column: 'id', direction: 'DESC' },
}) {
	static $fillable = ['body', 'category_id', 'metadata'] as const;
	static $timestamps = false;
	upperBody() {
		return this.get('body').toUpperCase();
	}
	category() {
		return this.belongsTo(Category, 'category_id');
	}
}

class Keyed extends defineModel({
	table: 'authoring_keyed',
	primaryKey: 'code',
	fields: { code: field.string(), label: field.string() },
}) {
	static $fillable = ['code', 'label'] as const;
	static $timestamps = false;
}

const Created =
	createServiceToken<AfterCommitRepositoryListener<ModelAttributes<Note>>>('authoring.created');

const settings = {
	default: 'main',
	connections: { main: { driver: 'sqlite' as const, filename: ':memory:' } },
	models: [Note, Category, Keyed],
};

test('registry assembly rejects a class without an authored model declaration', () => {
	class UnauthoredModel {}

	expect(() => createClassModelDefinition(UnauthoredModel as never)).toThrow(
		'Expected an authored model class.',
	);
});

async function schema(database: DatabaseSession) {
	await database.execute({
		text: 'CREATE TABLE authoring_categories(id INTEGER PRIMARY KEY, name TEXT)',
		params: [],
	});
	await database.execute({
		text: 'CREATE TABLE authoring_notes(id INTEGER PRIMARY KEY, category_id INTEGER, body TEXT, metadata TEXT, created_at TEXT)',
		params: [],
	});
	await database.execute({
		text: 'CREATE TABLE authoring_keyed(code TEXT PRIMARY KEY, label TEXT)',
		params: [],
	});
}

// Compile-time negative controls exercise inferred field names, values, and subclass retention.
function typeContract(database: DatabaseSession) {
	const notes = database.model(Note);

	void notes.create({ body: 'typed', category_id: null });
	// @ts-expect-error Unknown write field.
	void notes.create({ missing: 'field' });
	// @ts-expect-error Wrong declared value type.
	void notes.create({ body: 123 });
	// @ts-expect-error Wrong query value type.
	void notes.where({ body: 123 });
	// @ts-expect-error Wrong primary key type.
	void notes.find('one');
	// @ts-expect-error Wrong custom primary key type.
	void database.model(Keyed).find(1);
	void notes.findOrFail(1).then(async (note) => {
		(await note.category().where({ name: 'work' }).first())?.displayName();
		(await note.category())?.displayName();
		// @ts-expect-error Class relationship filters use declared field values.
		note.category().where({ name: 1 });
		// @ts-expect-error Class relationship filters reject undeclared fields.
		note.category().where({ missing: 'field' });
	});
	void database
		.model(Category)
		.findOrFail(1)
		.then(async (category) => {
			(
				await category.notes().where({ body: 'text' }).orderBy({ column: 'id' }).limit(2).get()
			)[0]?.upperBody();
			(await category.notes())[0]?.upperBody();
			(await category.notes().create({ body: 'text' })).upperBody();
			(await category.notes().createMany([{ body: 'text' }]))[0]?.upperBody();
			// @ts-expect-error Class relationship writes preserve declared values.
			category.notes().create({ body: 1 });
			// @ts-expect-error Class relationship writes reject unknown columns.
			category.notes().create({ missing: 'column' });
		});
	void notes.repository().create({ body: 'typed' });
	// @ts-expect-error Inferred internal repository keeps write safety.
	void notes.repository().create({ body: false });
	// @ts-expect-error Custom key is required when there is no id field.
	defineModel({ table: 'missing_key', fields: { code: field.string() } });
}

void typeContract;

describe('class model authoring', () => {
	test('infers an internal repository and hydrates subclass methods and class relationships', async () => {
		const events: ModelAttributes<Note>[] = [];

		await withBoundDatabase(
			{
				definition: {
					...settings,
					repositoryEffects: [modelEffects(Note, [{ action: 'created', afterCommit: Created }])],
				},
				services: [
					valueService(Created, (row) => {
						events.push({ ...row });
					}),
				],
			},
			async (database) => {
				await schema(database);
				const notes = database.model(Note);

				expect(database.model(Note)).toBe(notes);
				const category = await database.model(Category).create({ name: 'work' });

				const note = await notes.create({
					body: 'first',
					category_id: category.id,
					metadata: { tags: ['a'] },
				});

				expect(note).toBeInstanceOf(Note);
				expect(note.upperBody()).toBe('FIRST');
				expect(note.get('metadata')).toEqual({ tags: ['a'] });
				expect((await note.category().first())?.get('name')).toBe('work');
				expect((await category.notes().get())[0]).toBeInstanceOf(Note);
				expect(
					(await notes.with('category').findOrFail(note.id)).loaded('category'),
				).toBeInstanceOf(Category);
				expect(events).toHaveLength(1);
				const keyed = await database.model(Keyed).create({ code: 'abc', label: 'keyed' });

				expect(keyed.id).toBe('abc');
				expect((await database.model(Keyed).findOrFail('abc')).get('label')).toBe('keyed');
				expect(modelTable(Note).columns).toEqual([
					'id',
					'category_id',
					'body',
					'metadata',
					'created_at',
				]);
			},
		);
	});

	test('class models stay isolated across transaction branches and application snapshots', async () => {
		let foreign: Note | undefined;

		await withBoundDatabase({ definition: settings }, async (database) => {
			await schema(database);
			const notes = database.model(Note);

			const source = await notes.create({ body: 'original', metadata: { tags: [] } });

			foreign = source;
			await database.transaction(async (transaction) => {
				const branch = transaction.model(Note);

				expect(branch).not.toBe(notes);
				const rebound = branch.bind(source);

				expect(rebound).toBeInstanceOf(Note);
				expect(rebound.upperBody()).toBe('ORIGINAL');
				await rebound.update({ body: 'rolled back' });
				transaction.requestRollback();
			});
			expect((await notes.findOrFail(source.id)).get('body')).toBe('original');
		});
		await withBoundDatabase({ definition: settings }, async (database) => {
			await schema(database);
			expect(() => database.model(Note).bind(foreign as Note)).toThrow('authority mismatch');
		});
	});

	test('snapshots static metadata once and rejects unregistered classes and duplicates', async () => {
		class Mutable extends defineModel({
			table: 'authoring_mutable',
			fields: { id: field.number(), body: field.string() },
		}) {
			static $fillable = ['body'];
			static $timestamps = false;
			static scopeNever() {
				throw new Error('static scopes must not execute');
			}
		}

		const config = { ...settings, models: [Mutable] };

		const declarations = createDatabaseBindings(config);

		expect(declarations.length).toBeGreaterThan(0);
		expect(() => createDatabaseBindings({ ...config, models: [Mutable, Mutable] })).toThrow(
			'Duplicate model',
		);
		class SameName extends defineModel({
			table: 'duplicate_names',
			fields: { id: field.number() },
			name: 'Mutable',
		}) {}

		expect(() => createDatabaseBindings({ ...config, models: [Mutable, SameName] })).toThrow();
		const captured = Mutable.$fillable;

		await withBoundDatabase({ definition: config }, async (database) => {
			Mutable.$fillable = [];
			captured.push('unknown');
			await database.execute({
				text: 'CREATE TABLE authoring_mutable(id INTEGER PRIMARY KEY, body TEXT)',
				params: [],
			});
			expect((await database.model(Mutable).create({ body: 'snapshot' })).get('body')).toBe(
				'snapshot',
			);
			expect(() => database.model(Note)).toThrow('not registered');
		});
	});

	test('rejects metadata accessors without executing them', () => {
		let reads = 0;

		const options = {
			table: 'invalid',
			get fields() {
				reads++;

				return { id: field.number() };
			},
		};

		expect(() => defineModel(options)).toThrow('accessors');
		class Invalid extends defineModel({ table: 'invalid', fields: { id: field.number() } }) {
			static get $fillable() {
				reads++;

				return ['id'];
			}
		}

		expect(() => createDatabaseBindings({ ...settings, models: [Invalid] })).toThrow('accessors');
		expect(reads).toBe(0);
	});
	test('validates malformed declarations and preserves immutable declaration metadata', () => {
		const declare = defineModel as (options: unknown) => unknown;

		const fields = { id: field.number(), body: field.string() };

		for (const options of [
			{ table: 'invalid', fields: null },
			{ table: 'invalid', fields: Object.create({ id: field.number() }) },
			{ table: 'invalid', fields, unknown: true },
			{ table: ' ', fields },
			{ table: 'invalid', fields: { id: 'number' } },
			{ table: 'invalid', fields, primaryKey: 'missing' },
			{ table: 'invalid', fields, name: ' ' },
			{ table: 'invalid', fields, [Symbol('unsupported')]: true },
		]) {
			expect(() => declare(options)).toThrow(TypeError);
		}

		expect(() =>
			createDatabaseBindings({
				...settings,
				models: [class Unrelated {} as unknown as typeof Note],
			}),
		).toThrow();
		expect(() => modelTable(class Unrelated {} as unknown as typeof Note)).toThrow(
			'authored model',
		);
		const ordering = { column: 'id' as const, direction: 'ASC' as const };

		class Declared extends defineModel({
			table: 'declaration_snapshot',
			fields,
			defaultOrderBy: ordering,
		}) {}

		delete (fields as Partial<typeof fields>).body;
		expect(modelTable(Declared).columns).toEqual(['id', 'body']);
		expect(Object.isFrozen(modelTable(Declared))).toBe(true);
		expect(Object.isFrozen(modelTable(Declared).defaultOrderBy)).toBe(true);
	});

	test('field factories retain portable scalars and explicit static casts', async () => {
		class Portable extends defineModel({
			table: 'portable_fields',
			fields: {
				id: field.number(),
				flag: field.boolean(),
				happened_at: field.date().nullable(),
				payload: field.binary(),
			},
		}) {
			static $guarded = [];
			static $timestamps = false;
			static $casts = { flag: 'boolean' };
		}

		await withBoundDatabase(
			{ definition: { ...settings, models: [Portable] } },
			async (database) => {
				await database.execute({
					text: 'CREATE TABLE portable_fields(id INTEGER PRIMARY KEY, flag INTEGER, happened_at TEXT, payload BLOB)',
					params: [],
				});
				const record = await database
					.model(Portable)
					.create({ flag: 1, happened_at: null, payload: new Uint8Array([1, 2]) });

				expect(record.get('flag')).toBe(true);
				expect(record.get('happened_at')).toBeNull();
				expect([...record.get('payload')]).toEqual([1, 2]);
			},
		);
	});
});
