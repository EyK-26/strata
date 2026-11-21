/** Compiled against source and packed declarations; never executed. */
import { defineModel, field, type ModelAttributes } from '@getstrata/core/database/model';
import type { DatabaseSession } from '@getstrata/core/database/session';

class Category extends defineModel({
	table: 'authoring_contract_categories',
	fields: { id: field.number(), name: field.string() },
}) {
	static $fillable = ['name'] as const;
	static $timestamps = false;
	label(): string {
		return this.get('name');
	}
	notes() {
		return this.hasMany(() => Note, 'category_id');
	}
}

class Note extends defineModel({
	table: 'authoring_contract_notes',
	fields: {
		id: field.number(),
		category_id: field.nullable(field.number()),
		body: field.string(),
		created_at: field.timestamp(),
	},
}) {
	static $fillable = ['body', 'category_id'] as const;
	static $timestamps = false;
	upperBody(): string {
		return this.get('body').toUpperCase();
	}
	category() {
		return this.belongsTo(Category, 'category_id');
	}
}

export async function classModelContract(database: DatabaseSession): Promise<void> {
	const row: ModelAttributes<Note> = {
		id: 1,
		category_id: null,
		body: 'typed',
		created_at: new Date(),
	};

	const notes = database.model(Note);

	const note: Note = await notes.create({ body: row.body });

	const upper: string = note.upperBody();

	const category: Category | null = await note.category().first();

	const related: Note[] = category ? await category.notes().get() : [];

	const ordered: Note[] = category
		? await category.notes().where({ body: 'typed' }).orderBy({ column: 'id' }).limit(1).get()
		: [];

	const awaited: Note[] = category ? await category.notes() : [];

	const ownerLabel: string | undefined = (await note.category().first())?.label();

	if (category) {
		const child: Note = await category.notes().create({ body: 'related' });

		const upperChild: string = child.upperBody();

		// @ts-expect-error Relationship writes retain related field types.
		await category.notes().create({ body: 42 });
		// @ts-expect-error Unknown relationship write fields remain rejected.
		await category.notes().create({ missing: 'field' });
		void upperChild;
	}

	const selected = await notes.query().select('body').first();

	const body: string | undefined = selected?.body;

	// @ts-expect-error Declared model attributes reject the wrong scalar type.
	const wrong: ModelAttributes<Note> = { ...row, body: 42 };

	// @ts-expect-error Model writes retain inferred field types.
	await notes.create({ body: 42 });
	// @ts-expect-error Model queries retain inferred field types.
	await notes.where({ body: 42 }).get();
	// @ts-expect-error Primary keys retain the field's number type.
	await notes.find('wrong');
	// @ts-expect-error Unknown write fields remain rejected.
	await notes.create({ missing: 'field' });
	// @ts-expect-error Unknown read fields remain rejected.
	note.get('missing');
	void [upper, related, ordered, awaited, ownerLabel, body, wrong];
}
